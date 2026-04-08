// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * Enhanced Arbitrage Contract V2
 * Supports multi-hop arbitrage paths and triangular arbitrage
 * Optimized for gas efficiency and profit maximization
 */

interface IERC20 {
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
}

interface IPancakePair {
    function swap(uint amount0Out, uint amount1Out, address to, bytes calldata data) external;
    function token0() external view returns (address);
    function token1() external view returns (address);
    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);
}

interface IPancakeFactory {
    function getPair(address tokenA, address tokenB) external view returns (address pair);
}

interface IRouterV2 {
    function swapExactTokensForTokens(
        uint amountIn, uint amountOutMin,
        address[] calldata path, address to, uint deadline
    ) external returns (uint[] memory);
    function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts);
}

contract PancakeFlashArbitrageV2 {
    
    struct SwapStep {
        address router;
        address[] path;
        uint256 minOut;
    }

    struct MultiHopParams {
        address pair;
        address tokenBorrow;
        address tokenFinal;
        uint256 loanAmount;
        SwapStep[] swaps;
        uint256 minProfitBps;
        uint256 deadline;
        bytes32 nonce;
    }

    address public owner;
    address public immutable PANCAKE_FACTORY;
    
    uint256 private _status;
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;

    mapping(bytes32 => bool) public usedNonces;

    event MultiHopArbitrageExecuted(
        address indexed tokenBorrow, 
        address indexed tokenFinal,
        uint256 loanAmount, 
        uint256 profit,
        uint256 hops,
        uint256 timestamp
    );

    modifier onlyOwner() { require(msg.sender == owner, "Arb: not owner"); _; }

    modifier nonReentrant() {
        require(_status != _ENTERED, "Arb: reentrant");
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }

    constructor(address pancakeFactory) {
        owner = msg.sender;
        PANCAKE_FACTORY = pancakeFactory;
        _status = _NOT_ENTERED;
    }

    /**
     * Execute multi-hop arbitrage (triangular or longer paths)
     */
    function executeMultiHopArbitrage(MultiHopParams calldata p) external onlyOwner nonReentrant {
        require(block.timestamp <= p.deadline, "Arb: expired");
        require(!usedNonces[p.nonce], "Arb: nonce used");
        require(p.swaps.length >= 2, "Arb: need at least 2 swaps");
        usedNonces[p.nonce] = true;

        // Verify pair and get available liquidity
        bool isToken0 = (p.tokenBorrow == IPancakePair(p.pair).token0());
        (uint112 reserve0, uint112 reserve1,) = IPancakePair(p.pair).getReserves();
        uint256 availableLiquidity = isToken0 ? reserve0 : reserve1;
        
        require(p.loanAmount < (availableLiquidity * 9975) / 10000, "Arb: insufficient liquidity");

        // Initiate flash loan
        uint256 out0 = isToken0 ? p.loanAmount : 0;
        uint256 out1 = isToken0 ? 0 : p.loanAmount;

        IPancakePair(p.pair).swap(out0, out1, address(this), abi.encode(p));
    }

    /**
     * Flash loan callback
     */
    function pancakeCall(address sender, uint256, uint256, bytes calldata data) external {
        MultiHopParams memory p = abi.decode(data, (MultiHopParams));
        require(msg.sender == p.pair, "Arb: wrong pair");
        require(sender == address(this), "Arb: wrong sender");

        // Execute multi-hop swaps
        _executeSwaps(p);

        // Verify profit and settle
        _settle(p);
    }

    /**
     * Execute a series of swaps
     */
    function _executeSwaps(MultiHopParams memory p) internal {
        uint256 currentBalance = IERC20(p.tokenBorrow).balanceOf(address(this));
        require(currentBalance > 0, "Arb: no balance after loan");

        for (uint i = 0; i < p.swaps.length; i++) {
            SwapStep memory step = p.swaps[i];
            
            // Get current token balance
            address currentToken = step.path[0];
            uint256 balance = IERC20(currentToken).balanceOf(address(this));
            require(balance > 0, "Arb: zero balance for swap");

            // Approve router
            _approveIfNeeded(currentToken, step.router, balance);

            // Execute swap
            try IRouterV2(step.router).swapExactTokensForTokens(
                balance,
                step.minOut,
                step.path,
                address(this),
                block.timestamp + 120
            ) {} catch {
                revert("Arb: swap failed");
            }
        }
    }

    /**
     * Settle the arbitrage and verify profit
     */
    function _settle(MultiHopParams memory p) internal {
        // Calculate repay amount (with 0.25% fee)
        uint256 repay = ((p.loanAmount * 10000) / 9975) + 10;
        
        // Get final balance
        uint256 finalBalance = IERC20(p.tokenFinal).balanceOf(address(this));
        require(finalBalance >= repay, "Arb: insufficient final balance");

        // Calculate profit
        uint256 netProfit = finalBalance - repay;
        uint256 minProfit = (p.loanAmount * p.minProfitBps) / 10_000;
        require(netProfit >= minProfit, "Arb: profit too low");

        // Repay loan
        IERC20(p.tokenFinal).transfer(p.pair, repay);

        // Send profit to owner
        if (netProfit > 0) {
            IERC20(p.tokenFinal).transfer(owner, netProfit);
        }

        emit MultiHopArbitrageExecuted(
            p.tokenBorrow,
            p.tokenFinal,
            p.loanAmount,
            netProfit,
            p.swaps.length,
            block.timestamp
        );
    }

    /**
     * Approve token if needed (gas optimized)
     */
    function _approveIfNeeded(address token, address spender, uint256 amount) internal {
        uint256 currentAllowance = IERC20(token).allowance(address(this), spender);
        if (currentAllowance < amount) {
            if (currentAllowance > 0) {
                IERC20(token).approve(spender, 0);
            }
            IERC20(token).approve(spender, amount);
        }
    }

    /**
     * Withdraw tokens (emergency)
     */
    function withdraw(address token) external onlyOwner {
        if (token == address(0)) {
            (bool ok,) = payable(owner).call{value: address(this).balance}("");
            require(ok, "Arb: withdrawal failed");
        } else {
            uint256 bal = IERC20(token).balanceOf(address(this));
            if (bal > 0) {
                IERC20(token).transfer(owner, bal);
            }
        }
    }

    /**
     * Transfer ownership
     */
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Arb: zero address");
        owner = newOwner;
    }

    receive() external payable {}
}
