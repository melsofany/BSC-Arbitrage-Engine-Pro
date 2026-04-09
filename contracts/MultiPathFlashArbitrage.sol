// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ============================================================================
//
//   ██████╗ ███████╗ ██████╗     █████╗ ██████╗ ██████╗ 
//   ██╔══██╗██╔════╝██╔════╝    ██╔══██╗██╔══██╗██╔══██╗
//   ██████╔╝███████╗██║         ███████║██████╔╝██████╔╝
//   ██╔══██╗╚════██║██║         ██╔══██║██╔══██╗██╔══██╗
//   ██████╔╝███████║╚██████╗    ██║  ██║██║  ██║██████╔╝
//   ╚═════╝ ╚══════╝ ╚═════╝    ╚═╝  ╚═╝╚═╝  ╚═╝╚═════╝
//
//   Multi-Path Flash Arbitrage Engine v2.0
//   Supports: PancakeSwap V2/V3, UniswapV3, BiSwap, ApeSwap, BabySwap, MDEX
//   Features: Multi-hop paths, Full event logging, Gas-optimized
//
// ============================================================================

// ─────────────────────────────────────────────────────────────────────────────
// MINIMAL INTERFACES (gas-optimized: no unnecessary function signatures)
// ─────────────────────────────────────────────────────────────────────────────

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
    function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory);
}

interface IRouterUniV3 {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }
    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
}

interface IRouterPancakeV3 {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }
    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
}

interface IQuoterV2 {
    function quoteExactInputSingle(
        address tokenIn, address tokenOut, uint24 fee,
        uint256 amountIn, uint160 sqrtPriceLimitX96
    ) external returns (uint256 amountOut);
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

/// @dev DEX version identifiers (stored as uint8 to save gas)
uint8 constant DEX_V2         = 0;
uint8 constant DEX_UNI_V3     = 1;
uint8 constant DEX_PANCAKE_V3 = 2;

// ─────────────────────────────────────────────────────────────────────────────
// MAIN CONTRACT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @title MultiPathFlashArbitrage
 * @author Manus AI
 * @notice Advanced flash-loan arbitrage engine with multi-path support,
 *         comprehensive event logging, and gas optimizations for BSC.
 *
 * Architecture:
 *   1. Borrow via PancakeSwap V2 flash swap (zero-cost entry).
 *   2. Execute N buy steps across any supported DEX (V2 / UniV3 / PcV3).
 *   3. Execute M sell steps across any supported DEX.
 *   4. Repay flash loan + fee; transfer net profit to owner.
 *
 * Every step emits granular events so the off-chain bot can reconstruct
 * the full execution trace from transaction logs alone.
 */
contract MultiPathFlashArbitrage {

    // ─── Storage ─────────────────────────────────────────────────────────

    address public owner;
    address public immutable PANCAKE_FACTORY;

    /// @dev Reentrancy guard
    uint256 private _status;
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED     = 2;

    /// @dev Replay protection
    mapping(bytes32 => bool) public usedNonces;

    // ─── Events (comprehensive logging) ──────────────────────────────────

    // Generic debug
    event Debug(string message, uint256 value);
    event DebugAddr(string message, address value);
    event DebugBalance(address indexed token, uint256 balance, string stage);
    event DebugStep(string stepName, uint256 timestamp);

    // Execution lifecycle
    event ArbStarted(
        address indexed loanToken,
        uint256 loanAmount,
        uint256 minProfitBps,
        uint256 deadline,
        uint256 buySteps,
        uint256 sellSteps,
        bytes32 nonce
    );
    event ArbFinished(uint256 timestamp);

    // Flash loan
    event FlashLoanReceived(
        address indexed pair,
        address indexed token,
        uint256 amount,
        uint256 availableLiquidity
    );

    // Swap steps
    event SwapExecuted(
        uint8   indexed leg,         // 0 = buy, 1 = sell
        uint256 indexed stepIndex,
        address dexRouter,
        uint8   dexVersion,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 estimatedOut,
        uint256 actualOut,
        int256  slippageWei          // actualOut - estimatedOut (negative = worse)
    );

    // Approval
    event Approved(address indexed token, address indexed spender, uint256 amount);

    // Settlement
    event Settlement(
        address indexed token,
        uint256 loanAmount,
        uint256 fee,
        uint256 totalRepay,
        uint256 finalBalance,
        uint256 netProfit,
        uint256 profitBps
    );
    event ProfitSent(address indexed token, uint256 amount, address indexed recipient);

    // Errors
    event ExecutionFailed(string reason, string step);

    // Ownership
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    // ─── Structs ─────────────────────────────────────────────────────────

    /**
     * @notice Describes a single swap hop.
     * @param dexRouter   Router / SwapRouter address for this hop.
     * @param tokenIn     Input token for this hop.
     * @param tokenOut    Output token for this hop.
     * @param amountOutMin Minimum acceptable output (slippage protection).
     * @param fee         Pool fee tier for V3 DEXs (ignored for V2).
     * @param dexVersion  0 = V2, 1 = UniV3, 2 = PancakeV3.
     * @param quoter      Quoter address for V3 DEXs (address(0) for V2).
     */
    struct SwapHop {
        address dexRouter;
        address tokenIn;
        address tokenOut;
        uint256 amountOutMin;
        uint24  fee;
        uint8   dexVersion;
        address quoter;
    }

    /**
     * @notice Full arbitrage parameters passed in a single calldata blob.
     * @param flashPair     PancakeSwap V2 pair used for the flash swap.
     * @param loanToken     Token being borrowed.
     * @param loanAmount    Amount to borrow.
     * @param buyHops       Ordered list of swap hops for the "buy" leg.
     * @param sellHops      Ordered list of swap hops for the "sell" leg.
     * @param minProfitBps  Minimum net profit in basis points.
     * @param deadline      Block timestamp deadline.
     * @param nonce         Unique replay-protection nonce.
     */
    struct ArbParams {
        address   flashPair;
        address   loanToken;
        uint256   loanAmount;
        SwapHop[] buyHops;
        SwapHop[] sellHops;
        uint256   minProfitBps;
        uint256   deadline;
        bytes32   nonce;
    }

    // ─── Modifiers ───────────────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "Arb: not owner");
        _;
    }

    modifier nonReentrant() {
        require(_status != _ENTERED, "Arb: reentrant");
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }

    // ─── Constructor ─────────────────────────────────────────────────────

    constructor(address _pancakeFactory) {
        owner = msg.sender;
        PANCAKE_FACTORY = _pancakeFactory;
        _status = _NOT_ENTERED;
    }

    // ═════════════════════════════════════════════════════════════════════
    //  EXTERNAL ENTRY POINT
    // ═════════════════════════════════════════════════════════════════════

    /**
     * @notice Kick off a multi-path flash arbitrage.
     * @dev    Only callable by the contract owner.  Initiates a PancakeSwap
     *         V2 flash swap which will callback into `pancakeCall`.
     */
    function executeArbitrage(ArbParams calldata p) external onlyOwner nonReentrant {
        // ── Pre-flight checks ────────────────────────────────────────
        require(block.timestamp <= p.deadline, "Arb: expired");
        require(!usedNonces[p.nonce],          "Arb: nonce used");
        require(p.buyHops.length > 0,          "Arb: no buy hops");
        require(p.sellHops.length > 0,         "Arb: no sell hops");

        usedNonces[p.nonce] = true;

        emit ArbStarted(
            p.loanToken,
            p.loanAmount,
            p.minProfitBps,
            p.deadline,
            p.buyHops.length,
            p.sellHops.length,
            p.nonce
        );

        // ── Validate flash pair ──────────────────────────────────────
        address t0 = IPancakePair(p.flashPair).token0();
        address t1 = IPancakePair(p.flashPair).token1();
        require(
            p.loanToken == t0 || p.loanToken == t1,
            "Arb: loanToken not in flashPair"
        );

        // ── Check available liquidity ────────────────────────────────
        (uint112 r0, uint112 r1,) = IPancakePair(p.flashPair).getReserves();
        uint256 available = p.loanToken == t0 ? uint256(r0) : uint256(r1);
        emit Debug("Available Liquidity", available);
        require(p.loanAmount <= (available * 9975) / 10000, "Arb: loan > liquidity");

        emit FlashLoanReceived(p.flashPair, p.loanToken, p.loanAmount, available);

        // ── Initiate flash swap ──────────────────────────────────────
        bool isToken0 = (p.loanToken == t0);
        IPancakePair(p.flashPair).swap(
            isToken0 ? p.loanAmount : 0,
            isToken0 ? 0 : p.loanAmount,
            address(this),
            abi.encode(p)
        );
    }

    // ═════════════════════════════════════════════════════════════════════
    //  FLASH SWAP CALLBACK
    // ═════════════════════════════════════════════════════════════════════

    function pancakeCall(
        address _sender,
        uint256 /* _amount0 */,
        uint256 /* _amount1 */,
        bytes calldata _data
    ) external {
        emit DebugStep("pancakeCall", block.timestamp);

        ArbParams memory p = abi.decode(_data, (ArbParams));

        // ── Security checks ──────────────────────────────────────────
        require(msg.sender == p.flashPair,   "Arb: wrong pair");
        require(_sender    == address(this),  "Arb: wrong sender");

        uint256 borrowed = IERC20(p.loanToken).balanceOf(address(this));
        emit DebugBalance(p.loanToken, borrowed, "post-borrow");

        // ── Execute buy hops ─────────────────────────────────────────
        uint256 currentAmount = borrowed;
        address currentToken  = p.loanToken;

        for (uint256 i; i < p.buyHops.length; ) {
            (currentToken, currentAmount) = _executeHop(
                p.buyHops[i], currentToken, currentAmount, p.deadline, 0, i
            );
            unchecked { ++i; }
        }

        // ── Execute sell hops ────────────────────────────────────────
        for (uint256 i; i < p.sellHops.length; ) {
            (currentToken, currentAmount) = _executeHop(
                p.sellHops[i], currentToken, currentAmount, p.deadline, 1, i
            );
            unchecked { ++i; }
        }

        // ── Settle ───────────────────────────────────────────────────
        require(currentToken == p.loanToken, "Arb: final token != loanToken");
        _settle(p.flashPair, p.loanToken, p.loanAmount, currentAmount, p.minProfitBps);

        emit ArbFinished(block.timestamp);
    }

    // ═════════════════════════════════════════════════════════════════════
    //  INTERNAL: EXECUTE A SINGLE HOP
    // ═════════════════════════════════════════════════════════════════════

    function _executeHop(
        SwapHop memory hop,
        address currentToken,
        uint256 currentAmount,
        uint256 deadline,
        uint8   leg,        // 0 = buy, 1 = sell
        uint256 stepIndex
    ) internal returns (address nextToken, uint256 nextAmount) {

        require(currentToken == hop.tokenIn, "Arb: hop token mismatch");

        // ── Approve ──────────────────────────────────────────────────
        _approveMax(hop.tokenIn, hop.dexRouter, currentAmount);

        // ── Estimate output (for logging) ────────────────────────────
        uint256 estimatedOut = _quote(hop, currentAmount);
        emit Debug(leg == 0 ? "Buy Est. Out" : "Sell Est. Out", estimatedOut);

        // ── Snapshot balance before swap ─────────────────────────────
        uint256 balBefore = IERC20(hop.tokenOut).balanceOf(address(this));

        // ── Perform swap ─────────────────────────────────────────────
        _swap(hop, currentAmount, deadline);

        // ── Measure actual output ────────────────────────────────────
        uint256 balAfter = IERC20(hop.tokenOut).balanceOf(address(this));
        uint256 actualOut = balAfter - balBefore;
        require(actualOut > 0, "Arb: zero output");

        int256 slippage = int256(actualOut) - int256(estimatedOut);

        emit SwapExecuted(
            leg, stepIndex, hop.dexRouter, hop.dexVersion,
            hop.tokenIn, hop.tokenOut,
            currentAmount, estimatedOut, actualOut, slippage
        );
        emit DebugBalance(hop.tokenOut, actualOut, leg == 0 ? "post-buy" : "post-sell");

        return (hop.tokenOut, actualOut);
    }

    // ═════════════════════════════════════════════════════════════════════
    //  INTERNAL: QUOTING (read-only, for logging only)
    // ═════════════════════════════════════════════════════════════════════

    /**
     * @dev Returns an estimated output amount.  For V2 we use the router's
     *      `getAmountsOut`; for V3 we call the Quoter.  If the quote fails
     *      we return 0 instead of reverting (the swap itself will revert
     *      if the trade is bad).
     */
    function _quote(SwapHop memory hop, uint256 amountIn) internal returns (uint256) {
        if (hop.dexVersion == DEX_V2) {
            try IRouterV2(hop.dexRouter).getAmountsOut(
                amountIn, _pair(hop.tokenIn, hop.tokenOut)
            ) returns (uint256[] memory amounts) {
                return amounts[amounts.length - 1];
            } catch {
                return 0;
            }
        }

        // V3 quoting (UniV3 or PancakeV3)
        if (hop.quoter != address(0)) {
            try IQuoterV2(hop.quoter).quoteExactInputSingle(
                hop.tokenIn, hop.tokenOut, hop.fee, amountIn, 0
            ) returns (uint256 out) {
                return out;
            } catch {
                return 0;
            }
        }

        return 0;
    }

    // ═════════════════════════════════════════════════════════════════════
    //  INTERNAL: SWAP EXECUTION
    // ═════════════════════════════════════════════════════════════════════

    function _swap(SwapHop memory hop, uint256 amountIn, uint256 deadline) internal {
        if (hop.dexVersion == DEX_V2) {
            IRouterV2(hop.dexRouter).swapExactTokensForTokens(
                amountIn,
                hop.amountOutMin,
                _pair(hop.tokenIn, hop.tokenOut),
                address(this),
                deadline
            );
        } else if (hop.dexVersion == DEX_UNI_V3) {
            IRouterUniV3(hop.dexRouter).exactInputSingle(
                IRouterUniV3.ExactInputSingleParams({
                    tokenIn:           hop.tokenIn,
                    tokenOut:          hop.tokenOut,
                    fee:               hop.fee,
                    recipient:         address(this),
                    deadline:          deadline,
                    amountIn:          amountIn,
                    amountOutMinimum:  hop.amountOutMin,
                    sqrtPriceLimitX96: 0
                })
            );
        } else if (hop.dexVersion == DEX_PANCAKE_V3) {
            IRouterPancakeV3(hop.dexRouter).exactInputSingle(
                IRouterPancakeV3.ExactInputSingleParams({
                    tokenIn:           hop.tokenIn,
                    tokenOut:          hop.tokenOut,
                    fee:               hop.fee,
                    recipient:         address(this),
                    amountIn:          amountIn,
                    amountOutMinimum:  hop.amountOutMin,
                    sqrtPriceLimitX96: 0
                })
            );
        } else {
            emit ExecutionFailed("Unsupported DEX version", "_swap");
            revert("Arb: bad dexVersion");
        }
    }

    // ═════════════════════════════════════════════════════════════════════
    //  INTERNAL: SETTLEMENT
    // ═════════════════════════════════════════════════════════════════════

    function _settle(
        address flashPair,
        address loanToken,
        uint256 loanAmount,
        uint256 finalBalance,
        uint256 minProfitBps
    ) internal {
        emit DebugStep("_settle", block.timestamp);

        // PancakeSwap V2 flash swap fee = 0.3% → repay = loan * 10000 / 9970
        // Adding +1 wei to avoid rounding dust issues
        uint256 fee   = (loanAmount * 30) / 9970 + 1;
        uint256 repay = loanAmount + fee;

        emit Debug("Repay Amount", repay);
        emit Debug("Fee", fee);
        emit Debug("Final Balance", finalBalance);

        require(finalBalance >= repay, "Arb: cannot repay");

        uint256 netProfit = finalBalance - repay;
        uint256 profitBps = (netProfit * 10_000) / loanAmount;

        emit Settlement(
            loanToken, loanAmount, fee, repay,
            finalBalance, netProfit, profitBps
        );

        require(profitBps >= minProfitBps, "Arb: profit too low");

        // ── Transfer repayment to the flash pair ─────────────────────
        IERC20(loanToken).transfer(flashPair, repay);

        // ── Send profit to owner ─────────────────────────────────────
        if (netProfit > 0) {
            IERC20(loanToken).transfer(owner, netProfit);
            emit ProfitSent(loanToken, netProfit, owner);
        }
    }

    // ═════════════════════════════════════════════════════════════════════
    //  INTERNAL: HELPERS (gas-optimized)
    // ═════════════════════════════════════════════════════════════════════

    /// @dev Approve `spender` to spend `amount` of `token`.
    ///      Uses the "approve-to-zero-then-set" pattern for safety.
    ///      Only emits if a new approval is actually needed.
    function _approveMax(address token, address spender, uint256 amount) internal {
        uint256 current = IERC20(token).allowance(address(this), spender);
        if (current >= amount) return;

        if (current > 0) {
            IERC20(token).approve(spender, 0);
        }
        IERC20(token).approve(spender, type(uint256).max);
        emit Approved(token, spender, type(uint256).max);
    }

    /// @dev Build a 2-element path array (avoids repeated allocation).
    function _pair(address a, address b) internal pure returns (address[] memory p) {
        p = new address[](2);
        p[0] = a;
        p[1] = b;
    }

    // ═════════════════════════════════════════════════════════════════════
    //  ADMIN
    // ═════════════════════════════════════════════════════════════════════

    function withdraw(address token) external onlyOwner {
        if (token == address(0)) {
            (bool ok,) = payable(owner).call{value: address(this).balance}("");
            require(ok, "Arb: BNB fail");
        } else {
            uint256 bal = IERC20(token).balanceOf(address(this));
            if (bal > 0) IERC20(token).transfer(owner, bal);
        }
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Arb: zero addr");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    receive() external payable {}
}
