// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title Proof of Aid
/// @notice Tamper-evident records of disaster relief campaigns, aid distribution,
///         and independent verification. Evidence files live off-chain; only their
///         SHA-256 hash (and an optional URI) is recorded here.
/// @dev "Approved" means a verifier accepted the evidence under the system's rules.
///      It is not mathematical proof that the physical delivery happened.
contract ProofOfAid is AccessControl {
    // ---------------------------------------------------------------------
    // Roles
    // ---------------------------------------------------------------------

    /// @dev DEFAULT_ADMIN_ROLE (the deployer) grants/revokes the two roles below.
    bytes32 public constant NGO_ROLE = keccak256("NGO_ROLE");
    bytes32 public constant VERIFIER_ROLE = keccak256("VERIFIER_ROLE");

    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    enum CampaignStatus {
        Active,
        Closed
    }

    enum RecordStatus {
        Pending,
        Approved,
        Rejected
    }

    struct Campaign {
        uint256 id;
        address owner; // the NGO that created it
        string name;
        string resourceType; // e.g. "Food packages"
        uint256 targetQuantity;
        string location;
        CampaignStatus status;
        uint64 createdAt;
        // Running totals, kept separate so the dashboard can label them honestly.
        uint256 reportedQuantity; // everything the NGO reported (any status)
        uint256 verifiedQuantity; // quantity in Approved records
        uint256 rejectedQuantity; // quantity in Rejected records
        uint256 pendingCount;
        uint256 approvedCount;
        uint256 rejectedCount;
    }

    struct DistributionRecord {
        uint256 id;
        uint256 campaignId;
        address submitter;
        uint256 quantity;
        string location;
        bytes32 evidenceHash; // SHA-256 of the off-chain evidence file
        string evidenceURI; // optional link to the evidence (may be empty)
        RecordStatus status;
        address verifier; // zero address until decided
        uint64 submittedAt;
        uint64 verifiedAt; // zero until decided
    }

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    // IDs start at 1, so 0 always means "does not exist".
    uint256 public campaignCount;
    uint256 public recordCount;

    mapping(uint256 => Campaign) private _campaigns;
    mapping(uint256 => DistributionRecord) private _records;
    mapping(uint256 => uint256[]) private _campaignRecordIds;

    // ---------------------------------------------------------------------
    // Events (the public audit trail)
    // ---------------------------------------------------------------------

    event CampaignCreated(
        uint256 indexed campaignId,
        address indexed owner,
        string name,
        string resourceType,
        uint256 targetQuantity,
        string location
    );

    event CampaignClosed(uint256 indexed campaignId, address indexed closedBy);

    event DistributionSubmitted(
        uint256 indexed recordId,
        uint256 indexed campaignId,
        address indexed submitter,
        uint256 quantity,
        string location,
        bytes32 evidenceHash,
        string evidenceURI
    );

    event RecordVerified(
        uint256 indexed recordId,
        uint256 indexed campaignId,
        address indexed verifier,
        bool approved
    );

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error EmptyName();
    error ZeroQuantity();
    error EmptyEvidenceHash();
    error CampaignNotFound(uint256 campaignId);
    error RecordNotFound(uint256 recordId);
    error NotCampaignOwner(uint256 campaignId, address caller);
    error CampaignNotActive(uint256 campaignId);
    error RecordNotPending(uint256 recordId);
    error CannotVerifyOwnRecord(uint256 recordId);

    // ---------------------------------------------------------------------
    // Setup
    // ---------------------------------------------------------------------

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    // ---------------------------------------------------------------------
    // NGO actions
    // ---------------------------------------------------------------------

    /// @notice Create a relief campaign. Caller must hold NGO_ROLE.
    function createCampaign(
        string calldata name,
        string calldata resourceType,
        uint256 targetQuantity,
        string calldata location
    ) external onlyRole(NGO_ROLE) returns (uint256 campaignId) {
        if (bytes(name).length == 0) revert EmptyName();
        if (targetQuantity == 0) revert ZeroQuantity();

        campaignId = ++campaignCount;

        Campaign storage c = _campaigns[campaignId];
        c.id = campaignId;
        c.owner = msg.sender;
        c.name = name;
        c.resourceType = resourceType;
        c.targetQuantity = targetQuantity;
        c.location = location;
        c.status = CampaignStatus.Active;
        c.createdAt = uint64(block.timestamp);

        emit CampaignCreated(campaignId, msg.sender, name, resourceType, targetQuantity, location);
    }

    /// @notice Close a campaign so no further records can be submitted.
    ///         Only the NGO that created it can close it.
    function closeCampaign(uint256 campaignId) external {
        Campaign storage c = _getCampaign(campaignId);
        if (c.owner != msg.sender) revert NotCampaignOwner(campaignId, msg.sender);
        if (c.status != CampaignStatus.Active) revert CampaignNotActive(campaignId);

        c.status = CampaignStatus.Closed;
        emit CampaignClosed(campaignId, msg.sender);
    }

    /// @notice Submit a distribution record with its evidence hash.
    ///         Only the campaign's owner can submit, and only while it is Active.
    /// @param evidenceHash SHA-256 of the evidence file, calculated by the app.
    /// @param evidenceURI Optional link to the stored evidence (can be empty).
    ///        A quantity is NOT capped by the campaign target on purpose.
    function submitDistribution(
        uint256 campaignId,
        uint256 quantity,
        string calldata location,
        bytes32 evidenceHash,
        string calldata evidenceURI
    ) external returns (uint256 recordId) {
        Campaign storage c = _getCampaign(campaignId);
        if (c.owner != msg.sender) revert NotCampaignOwner(campaignId, msg.sender);
        if (c.status != CampaignStatus.Active) revert CampaignNotActive(campaignId);
        if (quantity == 0) revert ZeroQuantity();
        if (evidenceHash == bytes32(0)) revert EmptyEvidenceHash();

        recordId = ++recordCount;

        DistributionRecord storage r = _records[recordId];
        r.id = recordId;
        r.campaignId = campaignId;
        r.submitter = msg.sender;
        r.quantity = quantity;
        r.location = location;
        r.evidenceHash = evidenceHash;
        r.evidenceURI = evidenceURI;
        r.status = RecordStatus.Pending;
        r.submittedAt = uint64(block.timestamp);

        _campaignRecordIds[campaignId].push(recordId);

        c.reportedQuantity += quantity;
        c.pendingCount += 1;

        emit DistributionSubmitted(recordId, campaignId, msg.sender, quantity, location, evidenceHash, evidenceURI);
    }

    // ---------------------------------------------------------------------
    // Verifier actions
    // ---------------------------------------------------------------------

    /// @notice Approve or reject a Pending record. Caller must hold VERIFIER_ROLE
    ///         and cannot be the account that submitted the record.
    function verifyRecord(uint256 recordId, bool approved) external onlyRole(VERIFIER_ROLE) {
        DistributionRecord storage r = _getRecord(recordId);
        if (r.status != RecordStatus.Pending) revert RecordNotPending(recordId);
        if (r.submitter == msg.sender) revert CannotVerifyOwnRecord(recordId);

        Campaign storage c = _campaigns[r.campaignId];
        c.pendingCount -= 1;

        if (approved) {
            r.status = RecordStatus.Approved;
            c.verifiedQuantity += r.quantity;
            c.approvedCount += 1;
        } else {
            r.status = RecordStatus.Rejected;
            c.rejectedQuantity += r.quantity;
            c.rejectedCount += 1;
        }

        r.verifier = msg.sender;
        r.verifiedAt = uint64(block.timestamp);

        emit RecordVerified(recordId, r.campaignId, msg.sender, approved);
    }

    // ---------------------------------------------------------------------
    // Public views (used by the dashboard)
    // ---------------------------------------------------------------------

    function getCampaign(uint256 campaignId) external view returns (Campaign memory) {
        return _getCampaign(campaignId);
    }

    function getRecord(uint256 recordId) external view returns (DistributionRecord memory) {
        return _getRecord(recordId);
    }

    /// @notice IDs of all records submitted to a campaign, in submission order.
    function getCampaignRecordIds(uint256 campaignId) external view returns (uint256[] memory) {
        _getCampaign(campaignId); // reverts if the campaign does not exist
        return _campaignRecordIds[campaignId];
    }

    /// @notice Check a file's hash against what was recorded for a record.
    ///         The hash is calculated off-chain; this only compares.
    function matchesEvidence(uint256 recordId, bytes32 fileHash) external view returns (bool) {
        return _getRecord(recordId).evidenceHash == fileHash;
    }

    // ---------------------------------------------------------------------
    // Internal helpers
    // ---------------------------------------------------------------------

    function _getCampaign(uint256 campaignId) private view returns (Campaign storage c) {
        c = _campaigns[campaignId];
        if (c.id == 0) revert CampaignNotFound(campaignId);
    }

    function _getRecord(uint256 recordId) private view returns (DistributionRecord storage r) {
        r = _records[recordId];
        if (r.id == 0) revert RecordNotFound(recordId);
    }
}
