# Proof of Aid

**Making Every Aid Delivery Accountable.**

Proof of Aid is an open-source Ethereum dApp that makes disaster relief distribution publicly auditable. Relief organisations record what they distributed, authorised verifiers review the supporting evidence, and anyone can inspect which deliveries are only *reported* and which have been *independently verified*.

- **Live demo:** proof-of-aid-frontend-uz8j.vercel.app
- **Network:** Ethereum Sepolia testnet
- **Contract:** [`0xB64A54EDFA3Bc935430B2302966E11535e4735Cc`](https://sepolia.etherscan.io/address/0xB64A54EDFA3Bc935430B2302966E11535e4735Cc)

## The problem

After floods, earthquakes and landslides, people and organisations donate money, food and medicine. Donors often cannot check whether aid reached the people it was meant for. Distribution records sit in separate organisations, and evidence is hard to verify independently. A centralised system depends on the organisation keeping its own records honest, which makes independent auditing difficult.

## The solution

Proof of Aid keeps a tamper-evident public record of:

1. **Campaigns** created by relief organisations (NGOs).
2. **Distribution records** submitted by the NGO, each with the SHA-256 hash of its supporting evidence.
3. **Verification decisions** (approved or rejected) made by authorised verifiers.

The dashboard always separates what has been *reported* from what has been *verified*, so a donor does not have to rely only on the NGO's private report.

## How it works

| Role | What they can do |
|---|---|
| **Admin** (the deployer) | Authorises NGO and verifier wallets |
| **NGO** | Creates campaigns, submits distribution records with an evidence file, closes campaigns |
| **Verifier** | Approves or rejects pending records. Cannot decide a record they submitted themselves |
| **Public** | Views every campaign, record, status and evidence hash, and checks a file against its recorded hash. No wallet needed |

**Workflow**

1. The NGO creates a campaign (for example "Maharashtra Flood Relief", 1,000 food packages).
2. The NGO records a distribution (quantity, location) and picks an evidence file. The file is hashed with SHA-256 **in the browser**; only the hash (and an optional link) is written to Ethereum. The record starts as *Pending*.
3. A verifier reviews the evidence and approves or rejects the record. The decision is stored on-chain and emitted as an event.
4. The dashboard shows reported, verified and rejected quantities, pending records, and a verified-share bar for each campaign.
5. Anyone can pick a file and compare its hash with the recorded one. If the file was changed after submission, the hashes differ and the page shows a mismatch.

## What Proof of Aid is not

- It is not a donation or fundraising platform.
- It does not guarantee that an NGO is trustworthy.
- It does not prove that a photograph or receipt is genuine. A hash shows a file is **unchanged**, not that its contents are **true**.
- An approval means a verifier accepted the evidence under the system's rules. It is **not proof** that the physical delivery happened, and it does not replace physical inspection.

## Tech stack

| Layer | Technology |
|---|---|
| Smart contract | Solidity 0.8.34, OpenZeppelin `AccessControl` |
| Development and testing | Hardhat 3, TypeScript, Mocha, Ethers |
| Deployment | Hardhat Ignition (Sepolia) |
| Frontend | React, Vite, TypeScript, Ethers v6 |
| Wallet | MetaMask |
| Evidence integrity | SHA-256 (browser `crypto.subtle`) |
| Hosting | Vercel |

## Project structure

```
contracts/ProofOfAid.sol        Smart contract (roles, campaigns, records, verification, events)
test/ProofOfAid.ts              24 contract tests
ignition/modules/ProofOfAid.ts  Deployment module (deploys and grants roles)
ignition/parameters.sepolia.json  NGO and verifier wallet addresses used for deployment
frontend/                       React + Vite app
  src/chain.ts                  Contract access, data loading, hashing, error messages
  src/components/               Campaign list, NGO, verifier and admin panels, evidence check
```

## Smart contract

`ProofOfAid.sol` stores campaigns and distribution records and enforces the rules:

- Only NGOs can create campaigns, and only a campaign's owner can submit records to it, while it is active.
- Only verifiers can decide records, only once, and never on a record they submitted themselves.
- Each campaign keeps separate running totals for reported, verified and rejected quantities and for pending, approved and rejected records.
- Events (`CampaignCreated`, `CampaignClosed`, `DistributionSubmitted`, `RecordVerified`) give a public audit trail.
- Evidence files stay off-chain. Only the SHA-256 hash and an optional URI are stored.

## Run it locally

**Prerequisites:** Node.js 22 or newer, and MetaMask.

```bash
# Install and test the contract
npm install
npx hardhat test

# Run the frontend
cd frontend
npm install
npm run dev
```

Open the address Vite prints (usually `http://localhost:5173`) and connect MetaMask on the Sepolia network.

**Deploying your own copy to Sepolia**

1. Store your RPC URL and a test-only private key in Hardhat's keystore:
   ```bash
   npx hardhat keystore set SEPOLIA_RPC_URL
   npx hardhat keystore set SEPOLIA_PRIVATE_KEY
   ```
   Use a wallet that holds test ETH only.
2. Put the NGO and verifier wallet addresses in `ignition/parameters.sepolia.json`.
3. Deploy:
   ```bash
   npx hardhat ignition deploy ignition/modules/ProofOfAid.ts --network sepolia --parameters ignition/parameters.sepolia.json
   ```
4. Update `CONTRACT_ADDRESS` in `frontend/src/config.ts` with the new address.

## Try the demo

1. Connect the **NGO** wallet and create a campaign.
2. Record a distribution with an evidence file. It shows as **Pending**.
3. Switch to the **Verifier** wallet and approve the record. The verified quantity updates.
4. On the record, use **Check a file** with the original file (match), then with an edited copy (mismatch).

## Limitations

- Evidence files are not uploaded anywhere by the app. NGOs can add a link to where the file is hosted.
- The system is only as trustworthy as the verifiers the admin authorises.
- Deployed on a test network for demonstration.

## Roadmap

- Upload evidence to IPFS or another storage service
- Multiple verifiers per record, and a "request more evidence" status
- Verified source code on Etherscan
