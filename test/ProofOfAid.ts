import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.create();

// Mirror the enums in ProofOfAid.sol
const CampaignStatus = { Active: 0n, Closed: 1n };
const RecordStatus = { Pending: 0n, Approved: 1n, Rejected: 2n };

// Evidence is hashed off-chain with SHA-256; the contract only stores the result.
const hashOf = (text: string) => ethers.sha256(ethers.toUtf8Bytes(text));

async function deploy() {
  const [admin, ngo, otherNgo, verifier, stranger] = await ethers.getSigners();
  const poa = await ethers.deployContract("ProofOfAid");

  await poa.grantRole(await poa.NGO_ROLE(), ngo.address);
  await poa.grantRole(await poa.NGO_ROLE(), otherNgo.address);
  await poa.grantRole(await poa.VERIFIER_ROLE(), verifier.address);

  return { poa, admin, ngo, otherNgo, verifier, stranger };
}

describe("ProofOfAid", function () {
  let ctx: Awaited<ReturnType<typeof deploy>>;

  beforeEach(async function () {
    ctx = await deploy();
  });

  // Creates campaign #1 owned by `ngo`.
  async function createCampaign() {
    const { poa, ngo } = ctx;
    await poa
      .connect(ngo)
      .createCampaign("Maharashtra Flood Relief", "Food packages", 1000n, "Affected village");
  }

  // Submits a record to campaign #1 as `ngo`.
  async function submit(quantity: bigint, evidence = "distribution report") {
    const { poa, ngo } = ctx;
    return poa
      .connect(ngo)
      .submitDistribution(1n, quantity, "Village A", hashOf(evidence), "ipfs://evidence");
  }

  describe("roles", function () {
    it("makes the deployer admin, and nobody else an NGO or verifier by default", async function () {
      const { poa, admin } = ctx;
      expect(await poa.hasRole(await poa.DEFAULT_ADMIN_ROLE(), admin.address)).to.equal(true);
      expect(await poa.hasRole(await poa.NGO_ROLE(), admin.address)).to.equal(false);
      expect(await poa.hasRole(await poa.VERIFIER_ROLE(), admin.address)).to.equal(false);
    });

    it("lets only the admin grant roles", async function () {
      const { poa, stranger } = ctx;
      const ngoRole = await poa.NGO_ROLE();
      await expect(
        poa.connect(stranger).grantRole(ngoRole, stranger.address),
      ).to.be.revertedWithCustomError(poa, "AccessControlUnauthorizedAccount");
    });
  });

  describe("campaigns", function () {
    it("lets an NGO create a campaign and emits CampaignCreated", async function () {
      const { poa, ngo } = ctx;
      await expect(
        poa
          .connect(ngo)
          .createCampaign("Maharashtra Flood Relief", "Food packages", 1000n, "Affected village"),
      )
        .to.emit(poa, "CampaignCreated")
        .withArgs(1n, ngo.address, "Maharashtra Flood Relief", "Food packages", 1000n, "Affected village");

      const c = await poa.getCampaign(1n);
      expect(c.owner).to.equal(ngo.address);
      expect(c.name).to.equal("Maharashtra Flood Relief");
      expect(c.targetQuantity).to.equal(1000n);
      expect(c.status).to.equal(CampaignStatus.Active);
      expect(c.reportedQuantity).to.equal(0n);
      expect(await poa.campaignCount()).to.equal(1n);
    });

    it("blocks accounts without NGO_ROLE from creating campaigns", async function () {
      const { poa, stranger, verifier } = ctx;
      await expect(
        poa.connect(stranger).createCampaign("X", "Food", 10n, "Y"),
      ).to.be.revertedWithCustomError(poa, "AccessControlUnauthorizedAccount");
      await expect(
        poa.connect(verifier).createCampaign("X", "Food", 10n, "Y"),
      ).to.be.revertedWithCustomError(poa, "AccessControlUnauthorizedAccount");
    });

    it("rejects an empty name and a zero target", async function () {
      const { poa, ngo } = ctx;
      await expect(
        poa.connect(ngo).createCampaign("", "Food", 10n, "Y"),
      ).to.be.revertedWithCustomError(poa, "EmptyName");
      await expect(
        poa.connect(ngo).createCampaign("Name", "Food", 0n, "Y"),
      ).to.be.revertedWithCustomError(poa, "ZeroQuantity");
    });

    it("reverts when reading a campaign that does not exist", async function () {
      const { poa } = ctx;
      await expect(poa.getCampaign(99n))
        .to.be.revertedWithCustomError(poa, "CampaignNotFound")
        .withArgs(99n);
    });

    it("lets only the owner close a campaign, and only once", async function () {
      const { poa, ngo, otherNgo } = ctx;
      await createCampaign();

      await expect(poa.connect(otherNgo).closeCampaign(1n))
        .to.be.revertedWithCustomError(poa, "NotCampaignOwner")
        .withArgs(1n, otherNgo.address);

      await expect(poa.connect(ngo).closeCampaign(1n))
        .to.emit(poa, "CampaignClosed")
        .withArgs(1n, ngo.address);
      expect((await poa.getCampaign(1n)).status).to.equal(CampaignStatus.Closed);

      await expect(poa.connect(ngo).closeCampaign(1n))
        .to.be.revertedWithCustomError(poa, "CampaignNotActive")
        .withArgs(1n);
    });
  });

  describe("submitting distribution records", function () {
    beforeEach(async function () {
      await createCampaign();
    });

    it("stores the record as Pending and emits DistributionSubmitted", async function () {
      const { poa, ngo } = ctx;
      const hash = hashOf("distribution report");

      await expect(submit(100n))
        .to.emit(poa, "DistributionSubmitted")
        .withArgs(1n, 1n, ngo.address, 100n, "Village A", hash, "ipfs://evidence");

      const r = await poa.getRecord(1n);
      expect(r.campaignId).to.equal(1n);
      expect(r.submitter).to.equal(ngo.address);
      expect(r.quantity).to.equal(100n);
      expect(r.evidenceHash).to.equal(hash);
      expect(r.evidenceURI).to.equal("ipfs://evidence");
      expect(r.status).to.equal(RecordStatus.Pending);
      expect(r.verifier).to.equal(ethers.ZeroAddress);
      expect(r.verifiedAt).to.equal(0n);
      expect(await poa.recordCount()).to.equal(1n);
    });

    it("lists record ids per campaign in submission order", async function () {
      const { poa } = ctx;
      await submit(10n);
      await submit(20n);
      const ids = await poa.getCampaignRecordIds(1n);
      expect([...ids]).to.deep.equal([1n, 2n]);
    });

    it("allows quantities above the campaign target", async function () {
      const { poa } = ctx;
      await submit(5000n); // target is 1000
      expect((await poa.getCampaign(1n)).reportedQuantity).to.equal(5000n);
    });

    it("only lets the campaign owner submit", async function () {
      const { poa, otherNgo, stranger } = ctx;
      await expect(
        poa.connect(otherNgo).submitDistribution(1n, 10n, "V", hashOf("a"), ""),
      )
        .to.be.revertedWithCustomError(poa, "NotCampaignOwner")
        .withArgs(1n, otherNgo.address);
      await expect(
        poa.connect(stranger).submitDistribution(1n, 10n, "V", hashOf("a"), ""),
      ).to.be.revertedWithCustomError(poa, "NotCampaignOwner");
    });

    it("rejects submissions to a closed campaign", async function () {
      const { poa, ngo } = ctx;
      await poa.connect(ngo).closeCampaign(1n);
      await expect(submit(10n))
        .to.be.revertedWithCustomError(poa, "CampaignNotActive")
        .withArgs(1n);
    });

    it("rejects a zero quantity and an empty evidence hash", async function () {
      const { poa, ngo } = ctx;
      await expect(
        poa.connect(ngo).submitDistribution(1n, 0n, "V", hashOf("a"), ""),
      ).to.be.revertedWithCustomError(poa, "ZeroQuantity");
      await expect(
        poa.connect(ngo).submitDistribution(1n, 10n, "V", ethers.ZeroHash, ""),
      ).to.be.revertedWithCustomError(poa, "EmptyEvidenceHash");
    });

    it("rejects submissions to an unknown campaign", async function () {
      const { poa, ngo } = ctx;
      await expect(
        poa.connect(ngo).submitDistribution(42n, 10n, "V", hashOf("a"), ""),
      )
        .to.be.revertedWithCustomError(poa, "CampaignNotFound")
        .withArgs(42n);
    });
  });

  describe("verification", function () {
    beforeEach(async function () {
      await createCampaign();
      await submit(100n);
    });

    it("lets a verifier approve a record and emits RecordVerified", async function () {
      const { poa, verifier } = ctx;
      await expect(poa.connect(verifier).verifyRecord(1n, true))
        .to.emit(poa, "RecordVerified")
        .withArgs(1n, 1n, verifier.address, true);

      const r = await poa.getRecord(1n);
      expect(r.status).to.equal(RecordStatus.Approved);
      expect(r.verifier).to.equal(verifier.address);
      expect(r.verifiedAt > 0n).to.equal(true);
    });

    it("lets a verifier reject a record", async function () {
      const { poa, verifier } = ctx;
      await expect(poa.connect(verifier).verifyRecord(1n, false))
        .to.emit(poa, "RecordVerified")
        .withArgs(1n, 1n, verifier.address, false);
      expect((await poa.getRecord(1n)).status).to.equal(RecordStatus.Rejected);
    });

    it("blocks accounts without VERIFIER_ROLE", async function () {
      const { poa, ngo, stranger } = ctx;
      await expect(
        poa.connect(stranger).verifyRecord(1n, true),
      ).to.be.revertedWithCustomError(poa, "AccessControlUnauthorizedAccount");
      // An NGO is not automatically a verifier either.
      await expect(
        poa.connect(ngo).verifyRecord(1n, true),
      ).to.be.revertedWithCustomError(poa, "AccessControlUnauthorizedAccount");
    });

    it("stops a verifier from verifying a record they submitted themselves", async function () {
      const { poa, ngo } = ctx;
      // Give the submitting NGO the verifier role too; the independence rule must still hold.
      await poa.grantRole(await poa.VERIFIER_ROLE(), ngo.address);
      await expect(poa.connect(ngo).verifyRecord(1n, true))
        .to.be.revertedWithCustomError(poa, "CannotVerifyOwnRecord")
        .withArgs(1n);
    });

    it("does not allow a second decision on the same record", async function () {
      const { poa, verifier } = ctx;
      await poa.connect(verifier).verifyRecord(1n, true);
      await expect(poa.connect(verifier).verifyRecord(1n, false))
        .to.be.revertedWithCustomError(poa, "RecordNotPending")
        .withArgs(1n);
      await expect(poa.connect(verifier).verifyRecord(1n, true))
        .to.be.revertedWithCustomError(poa, "RecordNotPending")
        .withArgs(1n);
    });

    it("reverts for an unknown record", async function () {
      const { poa, verifier } = ctx;
      await expect(poa.connect(verifier).verifyRecord(99n, true))
        .to.be.revertedWithCustomError(poa, "RecordNotFound")
        .withArgs(99n);
    });
  });

  describe("campaign totals", function () {
    it("keeps reported, verified, rejected and pending figures separate", async function () {
      const { poa, verifier } = ctx;
      await createCampaign();
      await submit(100n, "report 1");
      await submit(250n, "report 2");
      await submit(50n, "report 3");

      let c = await poa.getCampaign(1n);
      expect(c.reportedQuantity).to.equal(400n);
      expect(c.verifiedQuantity).to.equal(0n);
      expect(c.pendingCount).to.equal(3n);

      await poa.connect(verifier).verifyRecord(1n, true); // 100 approved
      await poa.connect(verifier).verifyRecord(2n, false); // 250 rejected

      c = await poa.getCampaign(1n);
      expect(c.reportedQuantity).to.equal(400n); // reported never shrinks
      expect(c.verifiedQuantity).to.equal(100n);
      expect(c.rejectedQuantity).to.equal(250n);
      expect(c.pendingCount).to.equal(1n);
      expect(c.approvedCount).to.equal(1n);
      expect(c.rejectedCount).to.equal(1n);
    });

    it("tracks campaigns independently", async function () {
      const { poa, ngo, otherNgo, verifier } = ctx;
      await createCampaign(); // campaign 1, owned by ngo
      await poa.connect(otherNgo).createCampaign("Landslide Relief", "Blankets", 500n, "Hill village");

      await poa.connect(ngo).submitDistribution(1n, 100n, "A", hashOf("a"), "");
      await poa.connect(otherNgo).submitDistribution(2n, 30n, "B", hashOf("b"), "");
      await poa.connect(verifier).verifyRecord(2n, true);

      const c1 = await poa.getCampaign(1n);
      const c2 = await poa.getCampaign(2n);
      expect(c1.reportedQuantity).to.equal(100n);
      expect(c1.verifiedQuantity).to.equal(0n);
      expect(c2.reportedQuantity).to.equal(30n);
      expect(c2.verifiedQuantity).to.equal(30n);
    });
  });

  describe("evidence integrity", function () {
    it("matches the original file and detects a changed one", async function () {
      const { poa } = ctx;
      await createCampaign();
      await submit(100n, "distribution report v1");

      const original = hashOf("distribution report v1");
      const tampered = hashOf("distribution report v1 (edited)");

      expect(await poa.matchesEvidence(1n, original)).to.equal(true);
      expect(await poa.matchesEvidence(1n, tampered)).to.equal(false);
    });

    it("reverts when checking evidence for an unknown record", async function () {
      const { poa } = ctx;
      await expect(poa.matchesEvidence(7n, hashOf("x")))
        .to.be.revertedWithCustomError(poa, "RecordNotFound")
        .withArgs(7n);
    });
  });
});
