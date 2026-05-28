// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @dev Minimal USDC interface with EIP-2612 permit support
interface IUSDC is IERC20 {
    function permit(
        address owner,
        address spender,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;
}

/**
 * @title VIA Network
 * @notice ERC-1155 marketplace contract for any seller's product or service.
 *         Each listing is a tokenId. Buyers pay USDC via EIP-2612 permit.
 *         On-chain split is 70/30 between drop.creator and platformWallet —
 *         via-app always sets drop.creator = platformWallet so 100% of buyer
 *         USDC lands in platform reserves on mint, then off-chain
 *         auto-payout.ts sends the seller their 97.5% share. This indirection
 *         is what makes the off-chain split work atomically with the mint.
 *
 *         Direct fork of RRG.sol with two deliberate divergences:
 *           1. name = "VIA Network" (was "RRG - Real Real Genuine")
 *           2. maxSupply cap raised from 10000 to 1_000_000_000 to support
 *              services and digital goods with many slots / unlimited
 *              fulfilment (matches the lib/app/splits.ts 1e9 sentinel).
 *         All other behaviour (registerDrop, mintWithPermit, operatorMint,
 *         pauseDrop, setTokenURI, getDrop, uri, contractURI) is byte-identical
 *         to RRG.sol so lib/app/auto-payout.ts + permit.ts port unchanged.
 */
contract VIAnetwork is ERC1155, Ownable, ReentrancyGuardTransient {

    // ── Types ─────────────────────────────────────────────────────────

    struct Drop {
        address creator;
        uint256 priceUsdc;   // 6 decimal places (10 USDC = 10_000_000)
        uint256 maxSupply;   // 1 .. 1_000_000_000
        uint256 minted;
        bool    active;
    }

    // ── State ─────────────────────────────────────────────────────────

    IUSDC   public immutable usdc;
    address public immutable platformWallet;

    string  public name = "VIA Network";
    string  private _contractURI;

    mapping(uint256 => Drop) private _drops;
    mapping(uint256 => string) private _tokenURIs;

    // ── Events ────────────────────────────────────────────────────────

    event DropRegistered(
        uint256 indexed tokenId,
        address indexed creator,
        uint256 priceUsdc,
        uint256 maxSupply
    );

    event Minted(
        uint256 indexed tokenId,
        address indexed buyer,
        uint256 creatorShare,
        uint256 platformShare
    );

    event DropPaused(uint256 indexed tokenId);
    event DropUnpaused(uint256 indexed tokenId);
    event TokenURISet(uint256 indexed tokenId, string uri);

    /// @notice Emitted when the platform mints after verifying an off-chain payment
    event OperatorMinted(uint256 indexed tokenId, address indexed buyer);

    /// @notice ERC-7572: emitted when collection-level metadata changes
    event ContractURIUpdated();

    // ── Constructor ───────────────────────────────────────────────────

    /**
     * @param _usdc           USDC contract address (6 decimals)
     * @param _platformWallet Receives 100% of USDC on mint; off-chain payout
     *                        sends the seller their 97.5% share.
     * @param _baseUri        ERC-1155 base URI (e.g. "https://app.getvia.xyz/api/listings/")
     */
    constructor(
        address _usdc,
        address _platformWallet,
        string memory _baseUri
    ) ERC1155(_baseUri) Ownable(msg.sender) {
        require(_usdc != address(0), "VIA: zero usdc");
        require(_platformWallet != address(0), "VIA: zero platform wallet");
        usdc = IUSDC(_usdc);
        platformWallet = _platformWallet;
    }

    // ── Admin: Drop Management ─────────────────────────────────────────

    /**
     * @notice Register a seller's product or service as a purchasable listing.
     * @param tokenId      Unique token ID (assigned by app, must not exist)
     * @param creator      Drop creator. via-app always passes platformWallet
     *                     here so on-chain 70/30 collapses to 100% to platform.
     * @param priceUsdc6dp Price in USDC with 6 decimal places (10 USDC = 10_000_000)
     * @param maxSupply    Edition size. Must be 1 .. 1_000_000_000.
     */
    function registerDrop(
        uint256 tokenId,
        address creator,
        uint256 priceUsdc6dp,
        uint256 maxSupply
    ) external onlyOwner {
        require(_drops[tokenId].creator == address(0), "VIA: tokenId already registered");
        require(creator != address(0), "VIA: zero creator");
        require(priceUsdc6dp > 0, "VIA: zero price");
        require(maxSupply > 0 && maxSupply <= 1_000_000_000, "VIA: edition size must be 1 to 1e9");

        _drops[tokenId] = Drop({
            creator:    creator,
            priceUsdc:  priceUsdc6dp,
            maxSupply:  maxSupply,
            minted:     0,
            active:     true
        });

        emit DropRegistered(tokenId, creator, priceUsdc6dp, maxSupply);
    }

    /**
     * @notice Set or update the metadata URI for a token.
     */
    function setTokenURI(uint256 tokenId, string calldata tokenUri) external onlyOwner {
        require(_drops[tokenId].creator != address(0), "VIA: drop not found");
        _tokenURIs[tokenId] = tokenUri;
        emit TokenURISet(tokenId, tokenUri);
    }

    function pauseDrop(uint256 tokenId) external onlyOwner {
        require(_drops[tokenId].creator != address(0), "VIA: drop not found");
        _drops[tokenId].active = false;
        emit DropPaused(tokenId);
    }

    function unpauseDrop(uint256 tokenId) external onlyOwner {
        require(_drops[tokenId].creator != address(0), "VIA: drop not found");
        _drops[tokenId].active = true;
        emit DropUnpaused(tokenId);
    }

    // ── Purchase ───────────────────────────────────────────────────────

    /**
     * @notice Purchase a listing using an EIP-2612 permit signature.
     *         The buyer signs a permit off-chain; the server submits this
     *         transaction, paying gas on behalf of the buyer.
     *
     * @param tokenId  The listing to purchase
     * @param buyer    Address that will receive the token and pay USDC
     * @param deadline Permit expiry timestamp
     * @param v        Permit signature component
     * @param r        Permit signature component
     * @param s        Permit signature component
     */
    function mintWithPermit(
        uint256 tokenId,
        address buyer,
        uint256 deadline,
        uint8   v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant {
        Drop storage drop = _drops[tokenId];

        require(drop.creator != address(0), "VIA: drop not found");
        require(drop.active,                "VIA: drop not active");
        require(drop.minted < drop.maxSupply, "VIA: sold out");
        require(buyer != address(0),        "VIA: zero buyer");

        uint256 price = drop.priceUsdc;

        // Execute permit — approves this contract to pull price USDC from buyer
        usdc.permit(buyer, address(this), price, deadline, v, r, s);

        // Split payment atomically (70/30 on-chain — but creator is platformWallet
        // for every via-app listing, so 100% lands in platform reserves; off-chain
        // auto-payout then sends the seller 97.5%).
        uint256 creatorShare  = (price * 70) / 100;
        uint256 platformShare = price - creatorShare;

        require(
            usdc.transferFrom(buyer, drop.creator, creatorShare),
            "VIA: creator transfer failed"
        );
        require(
            usdc.transferFrom(buyer, platformWallet, platformShare),
            "VIA: platform transfer failed"
        );

        // Mint 1 token to buyer
        drop.minted += 1;
        _mint(buyer, tokenId, 1, "");

        emit Minted(tokenId, buyer, creatorShare, platformShare);
    }

    // ── Operator mint (off-chain payment verified, e.g. x402) ──────────

    /**
     * @notice Mint a token to a buyer after the platform has verified a direct
     *         USDC payment off-chain (e.g. via x402 from an AI agent).
     *         Payment handling is NOT done here — it was received and verified
     *         by the platform server before calling this function.
     *
     * @param tokenId The listing to mint
     * @param buyer   Address that will receive the ERC-1155 token
     */
    function operatorMint(uint256 tokenId, address buyer) external onlyOwner nonReentrant {
        Drop storage drop = _drops[tokenId];

        require(drop.creator != address(0), "VIA: drop not found");
        require(drop.active,                "VIA: drop not active");
        require(drop.minted < drop.maxSupply, "VIA: sold out");
        require(buyer != address(0),        "VIA: zero buyer");

        drop.minted += 1;
        _mint(buyer, tokenId, 1, "");

        emit OperatorMinted(tokenId, buyer);
    }

    // ── Views ──────────────────────────────────────────────────────────

    function getDrop(uint256 tokenId) external view returns (Drop memory) {
        return _drops[tokenId];
    }

    /**
     * @dev Returns per-token URI if set, otherwise falls back to base URI + tokenId.
     */
    function uri(uint256 tokenId) public view override returns (string memory) {
        string memory tokenUri = _tokenURIs[tokenId];
        if (bytes(tokenUri).length > 0) {
            return tokenUri;
        }
        return super.uri(tokenId);
    }

    /// @notice ERC-7572: collection-level metadata for marketplaces
    function contractURI() external view returns (string memory) {
        return _contractURI;
    }

    /// @notice Set collection-level metadata URI (owner only)
    function setContractURI(string calldata newURI) external onlyOwner {
        _contractURI = newURI;
        emit ContractURIUpdated();
    }
}
