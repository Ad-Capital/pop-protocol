// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";

/**
 * @title PredictionRegistry
 * @notice Traders post calls on-chain before the move. The oracle resolves Hit or Miss.
 */
contract PredictionRegistry {

    enum CallStatus { Open, Hit, Miss, Expired }

    struct PredictionCall {
        address trader;
        bool isLong;
        uint256 entryPrice;  // captured from oracle at post time; proof of timing
        uint256 takeProfit;
        uint256 stopLoss;
        uint256 postedAt;
        uint256 maxExpiry;
        CallStatus status;
    }

    struct TraderStats {
        uint32 totalCalls;
        uint32 hitCount;
        bool paused;
    }

    AggregatorV3Interface public oracle;
    uint256 public callCount;

    mapping(uint256 => PredictionCall) public calls;
    mapping(address => TraderStats) public stats;

    // Guards against pause triggering on first miss
    uint32 public constant MIN_CALLS_BEFORE_PAUSE = 5;

    // Stored as whole number, multiplied by 100 before division to preserve precision
    uint256 public constant PAUSE_THRESHOLD = 40;

    event CallPosted(
        uint256 indexed callId,
        address indexed trader,
        bool isLong,
        uint256 entryPrice,
        uint256 takeProfit,
        uint256 stopLoss,
        uint256 maxExpiry,
        uint256 postedAt
    );

    event CallResolved(
        uint256 indexed callId,
        address indexed trader,
        bool hit,
        uint256 resolvedPrice,
        uint256 resolvedAt
    );

    event TraderPaused(
        address indexed trader,
        uint32 totalCalls,
        uint32 hitCount
    );

    // Oracle address is injected; accepts MockOracle on testnet or a real feed on mainnet
    constructor(address _oracle) {
        oracle = AggregatorV3Interface(_oracle);
    }

    function postCall(
        bool isLong,
        uint256 takeProfit,
        uint256 stopLoss,
        uint256 maxExpiry
    ) external returns (uint256 callId) {
        require(maxExpiry > block.timestamp, "Expiry must be in the future");
        require(!stats[msg.sender].paused, "Trader is paused");

        (, int256 currentPrice,,, ) = oracle.latestRoundData();
        uint256 entryPrice = uint256(currentPrice);

        callId = callCount;
        callCount++;

        calls[callId] = PredictionCall({
            trader: msg.sender,
            isLong: isLong,
            entryPrice: entryPrice,
            takeProfit: takeProfit,
            stopLoss: stopLoss,
            postedAt: block.timestamp,
            maxExpiry: maxExpiry,
            status: CallStatus.Open
        });

        emit CallPosted(callId, msg.sender, isLong, entryPrice, takeProfit, stopLoss, maxExpiry, block.timestamp);
    }

    function resolve(uint256 callId) external {
        PredictionCall storage call = calls[callId];

        // postedAt is 0 for non-existent calls
        require(call.postedAt != 0, "Call does not exist");
        require(call.status == CallStatus.Open, "Call already resolved");

        (, int256 latestPrice,,, ) = oracle.latestRoundData();
        uint256 currentPrice = uint256(latestPrice);

        if (block.timestamp > call.maxExpiry) {
            call.status = CallStatus.Expired;
            _updateStats(call.trader, false);
            emit CallResolved(callId, call.trader, false, currentPrice, block.timestamp);
            return;
        }

        bool hit;
        bool resolved;

        if (call.isLong) {
            if (currentPrice >= call.takeProfit) { hit = true; resolved = true; }
            else if (currentPrice <= call.stopLoss) { resolved = true; }
        } else {
            if (currentPrice <= call.takeProfit) { hit = true; resolved = true; }
            else if (currentPrice >= call.stopLoss) { resolved = true; }
        }

        require(resolved, "Price has not crossed TP or SL yet");

        call.status = hit ? CallStatus.Hit : CallStatus.Miss;
        _updateStats(call.trader, hit);

        emit CallResolved(callId, call.trader, hit, currentPrice, block.timestamp);
    }

    function _updateStats(address trader, bool hit) internal {
        TraderStats storage traderStats = stats[trader];

        traderStats.totalCalls++;
        if (hit) traderStats.hitCount++;

        // Multiply before dividing to avoid integer precision loss
        if (
            traderStats.totalCalls >= MIN_CALLS_BEFORE_PAUSE &&
            (traderStats.hitCount * 100) / traderStats.totalCalls < PAUSE_THRESHOLD
        ) {
            traderStats.paused = true;
            emit TraderPaused(trader, traderStats.totalCalls, traderStats.hitCount);
        }
    }

    function getTraderStats(address trader) external view returns (
        uint32 totalCalls,
        uint32 hitCount,
        bool paused
    ) {
        TraderStats memory s = stats[trader];
        return (s.totalCalls, s.hitCount, s.paused);
    }

    function isPaused(address trader) external view returns (bool) {
        return stats[trader].paused;
    }
}
