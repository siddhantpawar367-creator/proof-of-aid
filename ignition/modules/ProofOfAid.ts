import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { id } from "ethers";

// Deploys ProofOfAid and grants the NGO and verifier roles.
// The deployer becomes the admin (DEFAULT_ADMIN_ROLE) automatically.
//
// The two role addresses come from ignition/parameters.sepolia.json
// (public wallet addresses only, never private keys).
export default buildModule("ProofOfAidModule", (m) => {
  const ngo = m.getParameter<string>("ngo");
  const verifier = m.getParameter<string>("verifier");

  const proofOfAid = m.contract("ProofOfAid");

  // Same hashing the contract uses: keccak256("NGO_ROLE") / keccak256("VERIFIER_ROLE")
  m.call(proofOfAid, "grantRole", [id("NGO_ROLE"), ngo], { id: "grantNgoRole" });
  m.call(proofOfAid, "grantRole", [id("VERIFIER_ROLE"), verifier], { id: "grantVerifierRole" });

  return { proofOfAid };
});
