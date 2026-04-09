// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ============================================================================
// IMPROVED PANCAKE FLASH ARBITRAGE CONTRACT
// ============================================================================
// Improvements:
// 1. Better profit calculation with dynamic slippage tolerance
// 2. More flexible sellMinOut handling
// 3. Enhanced error messages for debugging
// 4. Support for better gas optimization
// ============================================================================

interface IERC20 {
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
}

interface IPancakePair {
    function swap(uint amount0Out, uint amount1Out, address to, bytes calldata data) external;
    function token0() external view returns (address);
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

interface IRouterUniV3 {
    struct ExactInputSingleParams {
        address tokenIn; address tokenOut; uint24 fee; address recipient;
        uint256 deadline; uint256 amountIn; uint256 amountOutMinimum; uint160 sqrtPriceLimitX96;
    }
    function exactInputSingle(ExactInputSingleParams calldata p) external payable returns (uint256);
}

interface IRouterPancakeV3 {
    struct ExactInputSingleParams {
        address tokenIn; address tokenOut; uint24 fee; address recipient;
        uint256 amountIn; uint256 amountOutMinimum; uint160 sqrtPriceLimitX96;
    }
    function exactInputSingle(ExactInputSingleParams calldata p) external payable returns (uint256);
}

interface IQuoterV2UniV3 {
    function quoteExactInputSingle(
        address tokenIn,
        address tokenOut,
        uint24 fee,
        uint256 amountIn,
        uint160 sqrtPriceLimitX96
    ) external view returns (uint256 amountOut);
}

interface IQuoterV2PancakeV3 {
    function quoteExactInputSingle(
        address tokenIn,
        address tokenOut,
        uint24 fee,
        uint256 amountIn,
        uint160 sqrtPriceLimitX96
    ) external view returns (uint256 amountOut);
}

contract PancakeFlashArbitrageImproved {

    uint8 public constant DEX_V2         = 0;
    uint8 public constant DEX_UNI_V3     = 1;
    uint8 public constant DEX_PANCAKE_V3 = 2;

    struct Params {
        address pair;
        address tokenBorrow;
        address tokenOut;
        uint256 loanAmount;
        address buyDex;
        address sellDex;
        uint256 minProfitBps;
        bytes   buyCalldata;
        uint8   sellDexVersion; 
        uint24  sellFee;        
        uint256 deadline;
        bytes32 nonce;
        uint256 sellMinOut;
        address quoterAddress;
        uint256 dynamicSlippageBps; // NEW: Dynamic slippage tolerance in basis points (e.g., 50 = 0.5%)
    }

    address public owner;
    address public immutable PANCAKE_FACTORY;

    uint256 private _status;
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED     = 2;

    mapping(bytes32 => bool) public usedNonces;

    event ArbitrageExecuted(
        address indexed tokenBorrow, uint256 loanAmount, uint256 profit,
        address buyDex, address sellDex, uint256 timestamp
    );
    event BuyExecuted(address indexed tokenOut, uint256 amountOut, address buyDex, bytes buyCalldata);
    event SellExecuted(address indexed tokenIn, uint256 amountIn, address tokenOut, uint256 amountOutMin, address sellDex, uint8 sellDexVersion);
    event DebugBalance(address indexed token, uint256 balance, string stage);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event DebugLoanAmount(uint256 loanAmount);
    event DebugAvailableLiquidity(uint256 liquidity);
    event DebugSellMinOut(uint256 estimatedMinOut, uint256 finalMinOut);
    event DebugProfit(uint256 netProfit, uint256 profitBps); // NEW: Debug event for profit tracking
    event ExecutionFailed(string reason); // NEW: Event for detailed failure reasons

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

    function _approveIfNeeded(address token, address spender, uint256 amount) internal {
        uint256 currentAllowance = IERC20(token).allowance(address(this), spender);
        if (currentAllowance < amount) {
            if (currentAllowance > 0) {
                IERC20(token).approve(spender, 0);
            }
            IERC20(token).approve(spender, amount);
        }
    }

    function _validPair(address tA, address tB, address pair) internal view {
        require(IPancakeFactory(PANCAKE_FACTORY).getPair(tA, tB) == pair, "Arb: invalid pair");
    }

    function _buy(Params memory p) internal {
        require(block.timestamp <= p.deadline, "Arb: buy deadline exceeded");
        _approveIfNeeded(p.tokenBorrow, p.buyDex, p.loanAmount);
        (bool ok, bytes memory err) = p.buyDex.call(p.buyCalldata);
        require(ok, _revertMsg(err));
        uint256 outBalance = IERC20(p.tokenOut).balanceOf(address(this));
        require(outBalance > 0, "Arb: buy gave no output");
        emit BuyExecuted(p.tokenOut, outBalance, p.buyDex, p.buyCalldata);
        emit DebugBalance(p.tokenOut, outBalance, "after buy");
    }

    function _sell(Params memory p) internal {
        require(block.timestamp <= p.deadline, "Arb: sell deadline exceeded");
        uint256 bal = IERC20(p.tokenOut).balanceOf(address(this));
        require(bal > 0, "Arb: zero intermediate");
        _approveIfNeeded(p.tokenOut, p.sellDex, bal);

        uint256 estimatedMinOut = 0;
        // NEW: Use dynamic slippage tolerance if provided, otherwise default to 0.5%
        uint256 slippageTolerance = p.dynamicSlippageBps > 0 ? (10000 - p.dynamicSlippageBps) : 9950;

        if (p.sellDexVersion == DEX_UNI_V3) {
            require(p.quoterAddress != address(0), "Arb: UniV3 quoter address not set");
            estimatedMinOut = IQuoterV2UniV3(p.quoterAddress).quoteExactInputSingle(
                p.tokenOut, p.tokenBorrow, p.sellFee, bal, 0
            );
            uint256 finalMinOut = (estimatedMinOut * slippageTolerance) / 10000;
            emit DebugSellMinOut(estimatedMinOut, finalMinOut);
            IRouterUniV3(p.sellDex).exactInputSingle(IRouterUniV3.ExactInputSingleParams({
                tokenIn: p.tokenOut, tokenOut: p.tokenBorrow, fee: p.sellFee,
                recipient: address(this), deadline: block.timestamp + 120,
                amountIn: bal, amountOutMinimum: finalMinOut, sqrtPriceLimitX96: 0
            }));
        } else if (p.sellDexVersion == DEX_PANCAKE_V3) {
            require(p.quoterAddress != address(0), "Arb: PancakeV3 quoter address not set");
            estimatedMinOut = IQuoterV2PancakeV3(p.quoterAddress).quoteExactInputSingle(
                p.tokenOut, p.tokenBorrow, p.sellFee, bal, 0
            );
            uint256 finalMinOut = (estimatedMinOut * slippageTolerance) / 10000;
            emit DebugSellMinOut(estimatedMinOut, finalMinOut);
            IRouterPancakeV3(p.sellDex).exactInputSingle(IRouterPancakeV3.ExactInputSingleParams({
                tokenIn: p.tokenOut, tokenOut: p.tokenBorrow, fee: p.sellFee,
                recipient: address(this), amountIn: bal, amountOutMinimum: finalMinOut, sqrtPriceLimitX96: 0
            }));
        } else {
            // DEX_V2
            address[] memory path = new address[](2);
            path[0] = p.tokenOut; path[1] = p.tokenBorrow;
            uint[] memory amounts = IRouterV2(p.sellDex).getAmountsOut(bal, path);
            estimatedMinOut = amounts[amounts.length - 1];
            uint256 finalMinOut = (estimatedMinOut * slippageTolerance) / 10000;
            emit DebugSellMinOut(estimatedMinOut, finalMinOut);
            IRouterV2(p.sellDex).swapExactTokensForTokens(bal, finalMinOut, path, address(this), block.timestamp + 120);
        }
        
        uint256 finalBorrowBal = IERC20(p.tokenBorrow).balanceOf(address(this));
        emit SellExecuted(p.tokenOut, bal, p.tokenBorrow, p.sellMinOut, p.sellDex, p.sellDexVersion);
        emit DebugBalance(p.tokenBorrow, finalBorrowBal, "after sell");
    }

    function _settle(Params memory p) internal {
        // IMPROVED: Better repayment calculation with more accurate fee estimation
        // Flash loan fee is 0.3% (3/997 of the loan amount)
        uint256 repay = ((p.loanAmount * 10000) / 9970) + 10; 
        uint256 finalBalance = IERC20(p.tokenBorrow).balanceOf(address(this));
        
        if (finalBalance < repay) {
            emit ExecutionFailed("Insufficient balance to repay flash loan");
            require(false, "Arb: cannot repay");
        }

        uint256 netProfit = finalBalance - repay;
        uint256 minProfit = (p.loanAmount * p.minProfitBps) / 10_000;
        
        // NEW: Emit profit debug event
        emit DebugProfit(netProfit, (netProfit * 10000) / p.loanAmount);
        
        if (netProfit < minProfit) {
            emit ExecutionFailed("Profit below minimum threshold");
            require(false, "Arb: profit too low");
        }

        IERC20(p.tokenBorrow).transfer(p.pair, repay);

        if (netProfit > 0) {
            IERC20(p.tokenBorrow).transfer(owner, netProfit);
        }

        emit ArbitrageExecuted(p.tokenBorrow, p.loanAmount, netProfit, p.buyDex, p.sellDex, block.timestamp);
    }

    function _revertMsg(bytes memory d) internal pure returns (string memory) {
        if (d.length < 4) return "low-level call failed: data too short";
        if (d.length >= 68) {
            bytes memory errorMessageBytes = new bytes(d.length - 4);
            for (uint i = 0; i < d.length - 4; i++) {
                errorMessageBytes[i] = d[i + 4];
            }
            return abi.decode(errorMessageBytes, (string));
        }
        return "low-level call reverted with unknown reason";
    }

    function executeArbitrage(Params calldata p) external onlyOwner nonReentrant {
        require(block.timestamp <= p.deadline, "Arb: expired");
        require(!usedNonces[p.nonce], "Arb: nonce used");
        _validPair(p.tokenBorrow, p.tokenOut, p.pair);
        usedNonces[p.nonce] = true;

        bool isToken0  = (p.tokenBorrow == IPancakePair(p.pair).token0());
        (uint112 reserve0, uint112 reserve1,) = IPancakePair(p.pair).getReserves();
        uint256 availableLiquidity = isToken0 ? reserve0 : reserve1;
        
        emit DebugLoanAmount(p.loanAmount);
        emit DebugAvailableLiquidity(availableLiquidity);

        require(p.loanAmount < (availableLiquidity * 9970) / 10000, "Arb: Flash loan amount exceeds available liquidity after fee");

        uint256 out0   = isToken0 ? p.loanAmount : 0;
        uint256 out1   = isToken0 ? 0 : p.loanAmount;

        IPancakePair(p.pair).swap(out0, out1, address(this), abi.encode(p));
    }

    function pancakeCall(address sender, uint256, uint256, bytes calldata data) external {
        Params memory p = abi.decode(data, (Params));
        _validPair(p.tokenBorrow, p.tokenOut, msg.sender);
        require(msg.sender == p.pair,      "Arb: wrong pair");
        require(sender == address(this),   "Arb: wrong sender");

        _buy(p);
        _sell(p);
        _settle(p);
    }

    function withdraw(address token) external onlyOwner {
        if (token == address(0)) {
            (bool ok,) = payable(owner).call{value: address(this).balance}("");
            require(ok, "Arb: BNB withdrawal failed");
        } else {
            uint256 bal = IERC20(token).balanceOf(address(this));
            if (bal > 0) {
                IERC20(token).transfer(owner, bal);
            }
        }
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Arb: new owner is the zero address");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    receive() external payable {}
}

// ============================================================================
// IMPROVEMENTS SUMMARY:
// ============================================================================
// 1. Added dynamicSlippageBps parameter for flexible slippage control
// 2. Improved repayment calculation (9970 instead of 9975 for more accurate 0.3% fee)
// 3. Added DebugProfit event to track profit in basis points
// 4. Added ExecutionFailed event for better error tracking
// 5. Better error messages for debugging
// 6. More accurate profit calculation in _settle function
// ============================================================================
