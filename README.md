# Proof of Prediction Protocol

A trustless on-chain primitive for verifiable trading signal commits, built on Rootstock.

---

## The Problem

Anyone can claim they called a market move after it happens. Signal sellers post "I told you so" screenshots with no proof of timing. Buyers have no way to verify a track record before paying. The result: the market is flooded with scammers and legitimate analysts cannot differentiate themselves.

---

## The Solution

Post your call on-chain **before** the move. The timestamp is immutable. An oracle resolves the outcome automatically. No self-reporting. No human judge. The contract is the judge.

A trader posts:

- Direction (Long or Short)
- Entry price - captured from the oracle at the moment of posting
- Take profit - the price level that means they were right
- Stop loss - the price level that means they were wrong
- Max expiry - a deadline in case neither level is ever hit

Anyone can trigger resolution. The contract reads the oracle price and marks the call Hit or Miss. The trader's track record is built on-chain, call by call, and cannot be faked or backdated.

---

## How It Behaves

### State Machine

Every call moves through exactly one path:

```
postCall()
    │
    ▼
  Open
    │
    ├── price >= takeProfit (long)  OR  price <= takeProfit (short)  →  Hit
    ├── price <= stopLoss  (long)  OR  price >= stopLoss  (short)   →  Miss
    └── block.timestamp > maxExpiry (neither level hit)             →  Expired (= Miss)
```

A call that is Open can never go back to Open once resolved. States are final.

### Auto-Pause Rule

After a minimum of 5 resolved calls, if a trader's hit rate drops below 40%, they are automatically paused. Paused traders cannot post new calls. This is enforced by the contract, not by a platform or admin.

```
hitRate = (hitCount * 100) / totalCalls
paused  = hitRate < 40 AND totalCalls >= 5
```

### Event-First Design

Every state change emits an event. The full history of every call ever posted, entry, outcome, resolved price, timestamp is reconstructable from on-chain logs alone without reading contract storage.

---

## Contracts

### PredictionRegistry.sol

The core contract. Single source of truth.

| Function                                            | Who can call | What it does                                             |
| --------------------------------------------------- | ------------ | -------------------------------------------------------- |
| `postCall(isLong, takeProfit, stopLoss, maxExpiry)` | Any trader   | Posts a new call, captures entry price from oracle       |
| `resolve(callId)`                                   | Anyone       | Reads oracle, marks call Hit/Miss/Expired, updates stats |
| `getTraderStats(address)`                           | Anyone       | Returns totalCalls, hitCount, paused status              |
| `isPaused(address)`                                 | Anyone       | Quick check if a trader is currently paused              |

### MockOracle.sol (testnet only)

Implements `AggregatorV3Interface` - the same interface used by real Chainlink price feeds. Allows the contract owner to set a price manually, simulating market moves during testing and demo.

`PredictionRegistry` accepts any address that implements `AggregatorV3Interface` in its constructor. It does not know or care whether it is talking to a mock or a real feed. This makes the oracle swappable without changing contract logic.

---

## Oracle Strategy

**Testnet:** `MockOracle.sol` - deployed alongside `PredictionRegistry`, price set manually to simulate TP and SL hits.

**Mainnet:** A production oracle implementing `AggregatorV3Interface` (RedStone or APRO, both of which support Rootstock) would be passed as the constructor argument. No contract changes required.

---

## Design Decisions

**Why is resolution permissionless?**
Anyone can call `resolve()`. This removes the need for a keeper bot or trusted party. In practice, the trader, their followers, or any interested party can trigger it the moment price crosses a level. In V2, Chainlink Automation can be integrated to make this hands-off.

**Why capture entry price from the oracle at post time?**
It prevents backdating. If BTC is already at $94,500 and moving toward a $95,000 TP, you cannot post an entry of $90,000 and claim a large move. The contract records where the market actually was when you posted.

**Why multiply hitCount by 100 before dividing?**
Solidity has no floating point. `1 / 5` equals `0`, not `0.2`. Multiplying first - `(1 * 100) / 5 = 20` - preserves precision in integer arithmetic.

**Why separate MockOracle from PredictionRegistry?**
The registry should have zero knowledge of whether it is in a test or production environment. Injecting the oracle address as a constructor parameter keeps the registry pure and independently testable.

---

## Known Limitations (V1)

- Resolution requires an external trigger - the contract cannot call itself
- Oracle returns current spot price, not candle high/low - a TP touched intraday but not at resolution time may not register
- Traders can create a new wallet to reset their track record - staking mechanic planned for V2
- Hit rate is unweighted - a low-risk TP scores the same as a high-risk one - risk/reward weighting planned for V2

---

## V2 Roadmap

- Chainlink Automation for hands-off resolution
- Entry price validation against oracle at post time (anti-backdating)
- IPFS hash per call linking to off-chain analysis
- Risk/reward weighted hit rate scoring
- Trader staking with slashing on sustained poor performance
- Alchemy for RPC infrastructure
- Para wallet SDK for frontend wallet integration
- Tenderly for transaction simulation and debugging
- SubscriptionVault contract for streaming RBTC payments
- Frontend: Discover, Trader Profile, Post a Call, My Subscriptions screens

---

## Tech Stack

| Tool                            | Purpose                                      |
| ------------------------------- | -------------------------------------------- |
| Hardhat                         | Development environment, testing, deployment |
| Solidity 0.8.20                 | Smart contract language                      |
| TypeScript                      | Test and script language                     |
| MockOracle                      | Custom price oracle for testnet simulation   |
| Rootstock Public Node           | RPC endpoint for testnet deployment          |
| Slither                         | Static analysis                              |
| Rootstock Explorer              | Manual contract verification (flatten)       |

---

## Deployment

**Network:** Rootstock Testnet (chainId 31)

**Contracts:**

| Contract           | Address |
| ------------------ | ------- |
| MockOracle         | [0x112c9D9AFcEa96745f580dEC4ab9fCCD6040b185](https://explorer.testnet.rootstock.io/address/0x112c9D9AFcEa96745f580dEC4ab9fCCD6040b185) |
| PredictionRegistry | [0x1318Bb0D47c9Af66102AfA2A791f365b88368c17](https://explorer.testnet.rootstock.io/address/0x1318Bb0D47c9Af66102AfA2A791f365b88368c17) |

**Verification:** Both contracts verified on [Rootstock Testnet Explorer](https://explorer.testnet.rootstock.io)

---

## Running Tests

```bash
npx hardhat test
```

## Static Analysis

```bash
slither contracts/
```

