/**
 * Centralized help content for HelpTip components across the app.
 * Edit text here — all help tips update automatically.
 */

// ── Brand Login / Signup ─────────────────────────────────────────────
export const brandLogin = {
  googleAuth: {
    title: 'Google sign-in',
    content: 'Sign in with your Google account to get started. This creates a secure session linked to your email. If you\'re new, you\'ll be guided through brand registration after signing in.',
  },
  brandName: {
    title: 'Brand name',
    content: 'Enter the name your brand will be known by on the platform. This appears on your storefront, in listing pages, and on social posts. You can update it later in your brand settings.',
  },
  walletChoice: {
    title: 'Wallet setup',
    content: 'Your wallet receives USDC payments when your listings sell.\n\nUse your own wallet: If you already have an Ethereum-compatible wallet (MetaMask, Coinbase Wallet, etc.), paste the address here. You keep full control.\n\nCreate a new wallet: We\'ll generate an embedded wallet linked to your Google account. Simple, but you can switch to your own wallet later.',
  },
  applicationText: {
    title: 'Application',
    content: 'Tell us about your brand — what you create, your style, and why you want to join the platform. This helps our team review your application. There are no wrong answers — we\'re looking for original brands with a clear point of view.',
  },
  pendingApproval: {
    title: 'Pending approval',
    content: 'Your application is being reviewed by the team. This usually takes 24-48 hours. You\'ll receive an email when your brand is approved. If you need to make changes, contact us.',
  },
};

// ── Brand Admin Dashboard ────────────────────────────────────────────
export const brandAdmin = {
  submissions: {
    title: 'Submissions',
    content: 'View and manage all submissions from creators responding to your briefs. You can approve, reject, or request changes. Approved submissions become live listings on your storefront.',
  },
  drops: {
    title: 'Live listings',
    content: 'Your approved listings that are live on the storefront. Each listing shows sales, remaining editions, and revenue. Listings are purchasable by both humans and AI agents.',
  },
  briefs: {
    title: 'Briefs',
    content: 'Briefs are open calls for submissions from creators. Set a theme, deadline, and any specific requirements. Active briefs appear on your brand page and attract creator submissions.\n\nYou can have multiple briefs running simultaneously.',
  },
  settings: {
    title: 'Brand settings',
    content: 'Update your brand profile — name, description, logo, banner, social links, and contact information. These appear on your public brand page.',
  },
  logo: {
    title: 'Brand logo',
    content: 'Square image, JPEG or PNG, max 2 MB. This appears next to your brand name on the storefront, in listing pages, and in social posts. A simple, recognisable mark works best.',
  },
  banner: {
    title: 'Brand banner',
    content: 'Wide landscape image, JPEG or PNG, max 5 MB. This appears at the top of your brand page. Use it to set the tone — a hero image, campaign shot, or brand texture.',
  },
  socialLinks: {
    title: 'Social links',
    content: 'Add links to your social profiles. These appear on your brand page with clickable icons. Only fill in the ones you actively use — empty fields are hidden automatically.',
  },
  terms: {
    title: 'Terms & conditions',
    content: 'Review and accept the platform terms. These cover the revenue split, IP ownership, and platform rules. You must accept before your brand can go live.',
  },
  cardPayments: {
    title: 'Card payments',
    content: 'Enable credit/debit card payments on your listings. When enabled, buyers can pay by card in addition to USDC. Card processing fees (~3%) are deducted from the seller\'s share.\n\nThis opens your listings to buyers who don\'t have crypto wallets.',
  },
  offRamp: {
    title: 'Fiat off-ramp',
    content: 'Link a Bridge or Coinbase Commerce account to automatically convert USDC earnings to fiat (USD, EUR, etc.) and deposit to your bank account.\n\nIf not set up, you\'ll receive earnings as USDC to your wallet.',
  },
  // Field-level
  name: {
    title: 'Brand name',
    content: 'Your brand\'s display name. This appears on your storefront, in listing pages, and social posts. Keep it recognisable and consistent with your existing branding.',
  },
  headline: {
    title: 'Headline',
    content: 'A short tagline or positioning statement for your brand. Appears prominently on your brand page. Keep it punchy — one line that captures what you do.',
  },
  description: {
    title: 'Description',
    content: 'A longer description of your brand, your story, and what makes you unique. Appears on your brand page below the headline. Use this to build connection with potential buyers.',
  },
  contactEmail: {
    title: 'Contact email',
    content: 'Your brand\'s primary contact email. Used for platform communications and buyer enquiries about physical products. Not displayed publicly.',
  },
  website: {
    title: 'Website',
    content: 'Your brand\'s main website URL. Appears as a clickable link on your brand page. Include the full URL including https://.',
  },
};

// ── Brief Form Fields ────────────────────────────────────────────────
export const briefFields = {
  title: {
    title: 'Brief title',
    content: 'The name of your brief or challenge. This appears on your brand page and in submission forms. Make it descriptive and appealing to creators.',
  },
  description: {
    title: 'Brief description',
    content: 'Describe the theme, requirements, and creative direction. Be specific about what you\'re looking for — materials, style references, dimensions if relevant. The more detail you provide, the better submissions you\'ll receive.',
  },
  deadline: {
    title: 'Deadline',
    content: 'Optional end date for submissions. After this date, no new submissions will be accepted for this brief. Leave blank for an open-ended brief.',
  },
  isCurrent: {
    title: 'Current brief',
    content: 'Mark this as your current brief. The current brief is prominently displayed on your brand page and used as the default when creators submit new work.',
  },
};

// ── Product Fields ───────────────────────────────────────────────────
export const productFields = {
  physicalToggle: {
    title: 'Physical product',
    content: 'Enable this if the listing includes a real physical product (clothing, prints, accessories). Buyers will be asked for a shipping address. Fulfilment is arranged directly between you and the buyer.',
  },
  physicalTitle: {
    title: 'Physical product title',
    content: 'Name of the physical product included with the digital listing. This appears in the product details section on the listing page.',
  },
  physicalDescription: {
    title: 'Physical description',
    content: 'Describe the physical product — materials, dimensions, care instructions, or any other details buyers need to know before purchasing.',
  },
  physicalImages: {
    title: 'Product images',
    content: 'Add photos of the physical product. Multiple angles recommended. JPEG or PNG, max 5 MB each. These appear in a carousel on the listing page.',
  },
};

// ── Voucher Fields ───────────────────────────────────────────────────
export const voucherFields = {
  title: {
    title: 'Voucher title',
    content: 'Name of the voucher or perk. This appears to the buyer after purchase. Keep it clear — e.g. "10% Off First Order", "Free Shipping", "VIP Access".',
  },
  type: {
    title: 'Voucher type',
    content: 'The kind of benefit:\n\n• Percentage discount — e.g. 10% off\n• Fixed discount — e.g. $20 off\n• Free item — a complimentary product\n• Experience — access to an event or service\n• Custom — define your own perk',
  },
  value: {
    title: 'Voucher value',
    content: 'The specific value of the voucher. For percentage discounts, enter the percentage. For fixed discounts, enter the amount. For free items, describe what\'s included.',
  },
  terms: {
    title: 'Voucher terms',
    content: 'Any conditions or restrictions. E.g. "Valid for 30 days after purchase", "Cannot be combined with other offers", "Minimum order $50".',
  },
  brandUrl: {
    title: 'Redemption URL',
    content: 'Where buyers go to redeem the voucher. This could be your website, a specific product page, or a booking link.',
  },
  validDays: {
    title: 'Validity period',
    content: 'Number of days the voucher remains valid after purchase. After this period, the voucher expires automatically.',
  },
  maxUses: {
    title: 'Maximum uses',
    content: 'How many times each voucher code can be redeemed. Set to 1 for single-use vouchers.',
  },
};

// ── Creator Dashboard ────────────────────────────────────────────────
export const creatorDashboard = {
  submissions: {
    title: 'My submissions',
    content: 'All your submitted designs and their current status. Pending submissions are awaiting brand review. Approved submissions become live listings. Rejected submissions include feedback if provided.',
  },
  drops: {
    title: 'My listings',
    content: 'Your approved listings that are live on the storefront. Track sales, editions remaining, and your earnings from each listing.',
  },
  earnings: {
    title: 'Earnings',
    content: 'Your total USDC earnings from all sales. The creator split is set per brief — typically 35-80% of the sale price. Earnings are sent directly to your wallet at point of sale.',
  },
  profile: {
    title: 'Creator profile',
    content: 'Update your display name, bio, avatar, and social links. Your profile appears on listing pages next to your work. A complete profile builds trust with buyers.',
  },
  googleAuth: {
    title: 'Google sign-in',
    content: 'Sign in with Google to access your creator dashboard. Your submissions, earnings, and profile are linked to your Google account.',
  },
  walletConnect: {
    title: 'Wallet connection',
    content: 'Connect a wallet to receive USDC earnings. You can use an embedded wallet (created automatically) or connect your own external wallet (MetaMask, Coinbase Wallet, etc.).',
  },
};

// ── Superadmin ───────────────────────────────────────────────────────
export const superAdmin = {
  briefs: {
    title: 'Manage briefs',
    content: 'Create, edit, and manage briefs across all brands. Set themes, deadlines, submission requirements, and revenue splits. Active briefs appear on brand pages.',
  },
  submissions: {
    title: 'All submissions',
    content: 'Review submissions across all brands. Approve, reject, set pricing, edition counts, and token IDs. Approved submissions are minted as ERC-1155 tokens on Base.',
  },
  drops: {
    title: 'All listings',
    content: 'View and manage all live listings across the platform. Track sales, editions, and revenue. Edit pricing or edition counts if needed.',
  },
  brands: {
    title: 'Manage brands',
    content: 'Approve pending brand applications, edit brand details, manage brand members, and view brand analytics. Each brand has its own storefront and admin dashboard.',
  },
  distributions: {
    title: 'Distributions',
    content: 'Track all USDC distributions — creator payments, brand payments, and platform revenue. Each sale generates an on-chain transaction with transparent splits.',
  },
  marketing: {
    title: 'Marketing & outreach',
    content: 'Manage agent discovery, outreach campaigns, and commission tracking. Monitor ERC-8004 agent interactions and conversion metrics.',
  },
};

// ── Submission Form ──────────────────────────────────────────────────
export const submitForm = {
  heroImage: {
    title: 'Hero image',
    content: 'Your main image — this is what buyers see first. JPEG or PNG, high resolution recommended. This becomes the NFT image and appears in the storefront gallery.',
  },
  title: {
    title: 'Design title',
    content: 'A clear, descriptive title for your work. This appears in the storefront, social posts, and marketplace listings. Keep it concise but distinctive.',
  },
  description: {
    title: 'Description',
    content: 'Describe your design — the concept, materials, inspiration, or story behind it. This appears on the listing page. Buyers and AI agents use this to understand your work.',
  },
  price: {
    title: 'Price (USDC)',
    content: 'Set your selling price in USDC (1 USDC ≈ 1 USD). Consider your audience — we encourage accessible pricing to maximise reach. The revenue split is shown on the brief page.',
  },
  editions: {
    title: 'Edition size',
    content: 'How many copies can be sold. Lower editions create scarcity. Higher editions maximise revenue. Each edition is a unique ERC-1155 token on Base.',
  },
  additionalFiles: {
    title: 'Additional files',
    content: 'Optional supporting files — process work, technical sheets, behind-the-scenes material, or high-res alternates. Buyers receive these along with the hero image after purchase.',
  },
};
