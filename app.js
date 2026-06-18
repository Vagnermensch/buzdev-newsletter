/* =====================================================================
   Newsletter Builder — logic + renderer
   App UI = Clarity.  Output newsletters = Business Acumen / CCC theme.
   ===================================================================== */

/* ---------------------------------------------------------------------
   CCC / Business Acumen theme tokens (extracted from the .fig design file)
   --------------------------------------------------------------------- */
const THEME = {
  /* --- Base colors (exact, from the design system) --- */
  bg:         "#1A1A1A",  // Black — page background
  darkGray:   "#4E4E4E",  // Dark Gray
  mediumGray: "#9D9D9D",  // Medium Gray
  lightGray:  "#EFEFEF",  // Light Gray
  white:      "#FFFFFF",  // White
  /* --- Semantic neutrals (mapped to base colors) --- */
  border:    "#4E4E4E",   // Dark Gray — hairline dividers
  secondary: "#EFEFEF",   // Light Gray — body text
  muted:     "#9D9D9D",   // Medium Gray — labels / captions
  surface:   "#262626",   // raised surface (image placeholder)
  /* --- Accent colors (exact) --- */
  teal:   "#0F868E",
  blue:   "#18A9DA",
  purple: "#9747FF",
  pink:   "#E53293",
  orange: "#FF8539",
  yellow: "#CFEE69",
  // email-safe font stacks (web fonts load via <link>, with classic fallbacks)
  serif: "'Fraunces', Georgia, 'Times New Roman', serif",
  sans:  "'Inter', Helvetica, Arial, sans-serif",
};
// every accent the design system exposes, in palette order
const ACCENTS = {
  teal:   THEME.teal,
  blue:   THEME.blue,
  purple: THEME.purple,
  pink:   THEME.pink,
  orange: THEME.orange,
  yellow: THEME.yellow,
};
// readable text color when an accent is used as a *fill*
const ON_ACCENT = { teal: "#FFFFFF", blue: "#1A1A1A", purple: "#FFFFFF", pink: "#FFFFFF", orange: "#1A1A1A", yellow: "#1A1A1A" };

// Status taxonomy for Chip/Tag and Callout components (design file:
// Type = Urgent | Warning | Success | Info | Tip | Resource).
// Mapped onto the exact accent palette.
const STATUS = {
  urgent:   { color: THEME.pink,   glyph: "●", label: "Urgent" },
  warning:  { color: THEME.orange, glyph: "▲", label: "Warning" },
  success:  { color: THEME.teal,   glyph: "✓", label: "Success" },
  info:     { color: THEME.purple, glyph: "ⓘ", label: "Info" },
  tip:      { color: THEME.yellow, glyph: "✦", label: "Tip" },     // confirmed: TIP = yellow
  resource: { color: THEME.blue,   glyph: "◆", label: "Resource" },// confirmed: RESOURCE = blue
};
const STATUS_OPTIONS = Object.entries(STATUS).map(([value, s]) => ({ value, label: s.label }));
// Show/Hide toggle for the optional status chip on callouts.
const CHIP_TOGGLE = [{ value: "on", label: "Show" }, { value: "off", label: "Hide" }];

// Shared status chip (outlined rectangle) used by Tags and inside Callouts.
function chipMarkup(label, s, t, margin = "", padding = "9px 16px") {
  return `<span style="display:inline-block;font-family:${t.sans};font-size:12px;font-weight:600;line-height:1.5;letter-spacing:0.06em;text-transform:uppercase;border-radius:2px;padding:${padding};${margin}color:${s.color};background:${tint(s.color)};border:2px solid ${s.color};">${esc(label)}</span>`;
}

// 10% tint of an accent over the Black base — the design system's "X Tint 10%" token.
// Returns an email-safe solid hex.
function tint(hex, alpha = 0.10, base = THEME.bg) {
  const a = parseInt(hex.slice(1), 16), b = parseInt(base.slice(1), 16);
  const ch = i => {
    const sc = (a >> (i * 8)) & 255, dc = (b >> (i * 8)) & 255;
    return Math.round(sc * alpha + dc * (1 - alpha));
  };
  return "#" + [ch(2), ch(1), ch(0)].map(x => x.toString(16).padStart(2, "0")).join("");
}

/* ---------------------------------------------------------------------
   Helpers
   --------------------------------------------------------------------- */
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const uid = () => "b" + Math.random().toString(36).slice(2, 9);

function esc(str = "") {
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
// paragraph + line-break aware text for email bodies
function richText(str, style) {
  const safe = esc(str).trim();
  if (!safe) return "";
  return safe.split(/\n{2,}/).map(p =>
    `<p style="${style}">${p.replace(/\n/g, "<br>")}</p>`
  ).join("");
}
// wrap an accent phrase (italic + colored) inside an already-escaped headline
function emphasize(escapedText, phrase, color) {
  const p = esc((phrase || "").trim());
  if (!p) return escapedText;
  const i = escapedText.toLowerCase().indexOf(p.toLowerCase());
  if (i < 0) return escapedText;
  const before = escapedText.slice(0, i);
  const hit = escapedText.slice(i, i + p.length);
  const after = escapedText.slice(i + p.length);
  return `${before}<em style="font-style:italic;color:${color};">${hit}</em>${after}`;
}
// standard block row: vertical padding inline, horizontal padding via .px (responsive)
function row(content, vTop, vBot, extra = "") {
  return `<tr><td class="px" style="padding:${vTop}px 48px ${vBot}px 48px;${extra}">${content}</td></tr>`;
}

// Callout box (10% tint fill, rounded, thick status-colored top border).
// Shared by the single Callout block and the 2-up Callouts block.
function calloutBox(d, t) {
  const s = STATUS[d.type] || STATUS.tip;
  const fill = tint(s.color);
  const chip = d.chip === "off"
    ? ""
    : chipMarkup((d.tag && d.tag.trim()) || s.label, s, t, "", "6px 12px");
  // when the chip is hidden, the title sits flush against the box's top padding
  const title = d.title
    ? `<div style="font-family:${t.serif};font-weight:500;font-size:24px;line-height:1.25;color:${t.white};margin:${chip ? 24 : 0}px 0 0;">${esc(d.title)}</div>`
    : "";
  const body = d.text
    ? richText(d.text, `margin:10px 0 0;font-family:${t.sans};font-size:16px;line-height:1.6;color:${t.secondary};`)
    : "";
  let action = "";
  if (d.action) {
    // Outlined "ghost" button in the callout's own status color — distinct from
    // the cards block's solid accent button.
    const btnStyle = `display:inline-block;font-family:${t.sans};font-size:15px;font-weight:600;letter-spacing:0.01em;color:${s.color};text-decoration:none;`;
    const inner = d.href
      ? `<a href="${esc(d.href)}" target="_blank" style="${btnStyle}">${esc(d.action)} &rarr;</a>`
      : `<span style="${btnStyle}">${esc(d.action)} &rarr;</span>`;
    action = `<div style="margin-top:26px;">${inner}</div>`;
  }
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${fill}" style="background:${fill};border-radius:10px;border-top:3px solid ${s.color};">
           <tr><td style="padding:32px 32px 34px;">${chip}${title}${body}${action}</td></tr>
         </table>`;
}

/* ---------------------------------------------------------------------
   Block definitions: editor schema + email renderer
   --------------------------------------------------------------------- */
const DEFS = {
  masthead: {
    name: "Masthead", icon: "▤",
    defaults: { issue: "VOL. 04 · SPRING 2026", section: "BUSINESS ACUMEN" },
    fields: [
      { key: "issue",   label: "Issue label (yellow dot)", type: "text" },
      { key: "section", label: "Section label (orange dot)", type: "text" },
    ],
    render: (d, t) => {
      const dot = c => `<span style="display:inline-block;width:8px;height:8px;border-radius:99px;background:${c};vertical-align:middle;margin-right:8px;"></span>`;
      const lbl = "font-family:" + t.sans + ";font-size:11px;font-weight:600;letter-spacing:0.10em;color:" + t.white + ";text-transform:uppercase;vertical-align:middle;";
      const cell = (c, txt) => txt ? `<span style="${lbl}">${dot(c)}${esc(txt)}</span>` : "";
      const right = d.section ? `<span style="margin-left:28px;">${cell(t.orange, d.section)}</span>` : "";
      return row(
        `${cell(t.yellow, d.issue)}${right}`,
        40, 22,
        `border-bottom:1px solid ${t.border};`
      );
    },
  },

  hero: {
    name: "Hero headline", icon: "❡",
    defaults: { text: "The business of design.", emphasis: "design.", accent: "yellow" },
    fields: [
      { key: "text",     label: "Headline", type: "textarea" },
      { key: "emphasis", label: "Italic accent phrase (must appear in headline)", type: "text" },
      { key: "accent",   label: "Accent color", type: "swatch" },
    ],
    render: (d, t) => {
      const color = ACCENTS[d.accent] || t.yellow;
      const html = emphasize(esc(d.text), d.emphasis, color);
      return row(
        `<div class="hero" style="font-family:${t.serif};font-weight:400;font-size:66px;line-height:0.98;letter-spacing:-0.02em;color:${t.white};">${html}</div>`,
        30, 8
      );
    },
  },

  lead: {
    name: "Lead / intro", icon: "“",
    defaults: { text: "A practice tool for designers learning to speak the language of business." },
    fields: [{ key: "text", label: "Intro text", type: "textarea" }],
    render: (d, t) => row(
      richText(d.text, `margin:0 0 12px;font-family:${t.serif};font-style:italic;font-weight:400;font-size:23px;line-height:1.45;color:${t.secondary};`),
      8, 18
    ),
  },

  heading: {
    name: "Section heading", icon: "H",
    defaults: { eyebrow: "FEATURE", text: "Welcome back." },
    fields: [
      { key: "eyebrow", label: "Eyebrow (optional, uppercase)", type: "text" },
      { key: "text",    label: "Heading", type: "text" },
    ],
    render: (d, t) => {
      const eb = d.eyebrow ? `<div style="font-family:${t.sans};font-size:11px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:${t.muted};margin-bottom:10px;">${esc(d.eyebrow)}</div>` : "";
      return row(
        `${eb}<div style="font-family:${t.serif};font-weight:400;font-size:38px;line-height:1.05;letter-spacing:-0.01em;color:${t.white};">${esc(d.text)}</div>`,
        26, 8
      );
    },
  },

  paragraph: {
    name: "Paragraph", icon: "¶",
    defaults: { text: "Type your body copy here. Leave a blank line to start a new paragraph." },
    fields: [{ key: "text", label: "Body text", type: "textarea" }],
    render: (d, t) => row(
      richText(d.text, `margin:0 0 16px;font-family:${t.sans};font-size:16px;line-height:1.65;color:${t.secondary};`),
      8, 8
    ),
  },

  stat: {
    name: "Stat", icon: "#",
    defaults: { value: "73%", label: "of designers can’t read a P&L", accent: "yellow" },
    fields: [
      { key: "value", label: "Big number / value", type: "text" },
      { key: "label", label: "Caption", type: "text" },
      { key: "accent", label: "Accent color", type: "swatch" },
    ],
    render: (d, t) => {
      const color = ACCENTS[d.accent] || t.yellow;
      return row(
        `<div style="font-family:${t.serif};font-weight:400;font-size:72px;line-height:0.9;letter-spacing:-0.02em;color:${color};">${esc(d.value)}</div>
         <div style="font-family:${t.sans};font-size:13px;font-weight:500;letter-spacing:0.04em;text-transform:uppercase;color:${t.muted};margin-top:10px;">${esc(d.label)}</div>`,
        22, 22
      );
    },
  },

  quote: {
    name: "Pull quote", icon: "❝",
    defaults: { text: "Design is the silent ambassador of your brand.", cite: "Paul Rand" },
    fields: [
      { key: "text", label: "Quote", type: "textarea" },
      { key: "cite", label: "Attribution", type: "text" },
    ],
    render: (d, t) => {
      const cite = d.cite ? `<div style="font-family:${t.sans};font-size:12px;font-weight:600;letter-spacing:0.10em;text-transform:uppercase;color:${t.yellow};margin-top:16px;">— ${esc(d.cite)}</div>` : "";
      return row(
        `<div style="border-left:3px solid ${t.yellow};padding-left:24px;">
           <div style="font-family:${t.serif};font-style:italic;font-weight:400;font-size:28px;line-height:1.3;color:${t.white};">${esc(d.text)}</div>
           ${cite}
         </div>`,
        20, 20
      );
    },
  },

  notecard: {
    name: "Bordered note", icon: "▌",
    defaults: {
      title: "A note worth flagging",
      text: "Body copy in the same style as a paragraph. Leave a blank line to start a new paragraph.",
      accent: "yellow",
    },
    fields: [
      { key: "title",  label: "Title", type: "text" },
      { key: "text",   label: "Body text", type: "textarea" },
      { key: "accent", label: "Line color", type: "swatch" },
    ],
    render: (d, t) => {
      const color = ACCENTS[d.accent] || t.yellow;
      const title = d.title
        ? `<div style="font-family:${t.serif};font-weight:500;font-size:24px;line-height:1.25;color:${t.white};margin:0 0 6px;">${esc(d.title)}</div>`
        : "";
      // body uses the exact paragraph style (sans 16px / 1.65 / secondary)
      const body = richText(d.text, `margin:0 0 16px;font-family:${t.sans};font-size:16px;line-height:1.65;color:${t.secondary};`);
      return row(
        `<div style="border-left:3px solid ${color};padding-left:24px;">${title}${body}</div>`,
        20, 20
      );
    },
  },

  tags: {
    name: "Tags / Chips", icon: "⌗",
    defaults: { items: "Strategy, Pricing, Retention", type: "info", icon: "off" },
    fields: [
      { key: "items", label: "Tags (comma-separated)", type: "text" },
      { key: "type",  label: "Status type", type: "select", options: STATUS_OPTIONS },
      { key: "icon",  label: "Status icon", type: "select", options: [
        { value: "off", label: "Hide" },
        { value: "on",  label: "Show" },
      ] },
    ],
    render: (d, t) => {
      const s = STATUS[d.type] || STATUS.info;
      const items = (d.items || "").split(",").map(x => x.trim()).filter(Boolean);
      if (!items.length) return "";
      // Chip: outlined rectangle — 2px status border, 10% tint fill, semibold uppercase status text.
      const ico = d.icon === "on" ? `${s.glyph}  ` : "";
      const chip = (label) => chipMarkup(ico + label, s, t, "margin:0 8px 8px 0;");
      return row(items.map(chip).join(""), 12, 12);
    },
  },

  callout: {
    name: "Callout", icon: "❖",
    defaults: {
      type: "tip",
      chip: "on",
      tag: "",
      title: "Title",
      text: "Body description",
      action: "Action",
      href: "",
    },
    fields: [
      { key: "type",   label: "Status type", type: "select", options: STATUS_OPTIONS },
      { key: "chip",   label: "Chip", type: "select", options: CHIP_TOGGLE },
      { key: "tag",    label: "Chip label (blank = status name)", type: "text" },
      { key: "title",  label: "Title", type: "text" },
      { key: "text",   label: "Body description", type: "textarea" },
      { key: "action", label: "Action label (optional)", type: "text" },
      { key: "href",   label: "Action link (optional)", type: "text", placeholder: "https://…" },
    ],
    render: (d, t) => row(calloutBox(d, t), 14, 14),
  },

  callouts: {
    name: "Callouts (2-up)", icon: "❖❖",
    defaults: {
      type1: "tip",      chip1: "on", tag1: "", title1: "Key takeaway",
      text1: "Frame design decisions in the language stakeholders speak.",
      action1: "", href1: "",
      type2: "resource", chip2: "on", tag2: "", title2: "Workshop this Thursday",
      text2: "Tune in to your Local Design Jam for the follow-up workshop.",
      action2: "Add to calendar", href2: "",
    },
    fields: [
      { key: "type1",   label: "Card 1 — status type", type: "select", options: STATUS_OPTIONS },
      { key: "chip1",   label: "Card 1 — chip", type: "select", options: CHIP_TOGGLE },
      { key: "tag1",    label: "Card 1 — chip label (blank = status name)", type: "text" },
      { key: "title1",  label: "Card 1 — title", type: "text" },
      { key: "text1",   label: "Card 1 — body", type: "textarea" },
      { key: "action1", label: "Card 1 — action label (optional)", type: "text" },
      { key: "href1",   label: "Card 1 — action link (optional)", type: "text", placeholder: "https://…" },
      { key: "type2",   label: "Card 2 — status type (blank = single)", type: "select", options: [{ value: "", label: "— none (single card) —" }, ...STATUS_OPTIONS] },
      { key: "chip2",   label: "Card 2 — chip", type: "select", options: CHIP_TOGGLE },
      { key: "tag2",    label: "Card 2 — chip label (blank = status name)", type: "text" },
      { key: "title2",  label: "Card 2 — title", type: "text" },
      { key: "text2",   label: "Card 2 — body", type: "textarea" },
      { key: "action2", label: "Card 2 — action label (optional)", type: "text" },
      { key: "href2",   label: "Card 2 — action link (optional)", type: "text", placeholder: "https://…" },
    ],
    render: (d, t) => {
      const pick = n => ({ type: d["type" + n], chip: d["chip" + n], tag: d["tag" + n], title: d["title" + n], text: d["text" + n], action: d["action" + n], href: d["href" + n] });
      const c1 = calloutBox(pick(1), t);
      // Card 2 only renders when a status type is chosen — otherwise full-width single.
      if (!d.type2) return row(c1, 14, 14);
      const c2 = calloutBox(pick(2), t);
      // Two columns with a gutter; collapses to stacked full-width under 600px (.card-col CSS).
      return row(
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
           <td class="card-col" width="50%" valign="top" style="padding-right:9px;">${c1}</td>
           <td class="card-col" width="50%" valign="top" style="padding-left:9px;">${c2}</td>
         </tr></table>`,
        14, 14
      );
    },
  },

  image: {
    name: "Image", icon: "▣",
    defaults: { src: "", alt: "", caption: "" },
    fields: [
      { key: "src",     label: "Image (paste a URL or upload a file)", type: "image", placeholder: "https://…" },
      { key: "alt",     label: "Alt text", type: "text" },
      { key: "caption", label: "Caption (optional)", type: "text" },
    ],
    render: (d, t) => {
      const src = d.src ||
        "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='584' height='300'%3E%3Crect width='584' height='300' fill='%23232323'/%3E%3Ctext x='50%25' y='50%25' fill='%237c7c7c' font-family='Inter,Arial' font-size='14' text-anchor='middle' dominant-baseline='middle'%3EImage URL%3C/text%3E%3C/svg%3E";
      const cap = d.caption ? `<div style="font-family:${t.sans};font-size:12px;color:${t.muted};margin-top:10px;">${esc(d.caption)}</div>` : "";
      return row(
        `<img src="${esc(src)}" alt="${esc(d.alt)}" width="584" referrerpolicy="no-referrer" style="display:block;width:100%;max-width:584px;height:auto;border:0;border-radius:6px;outline:none;text-decoration:none;" />${cap}`,
        14, 14
      );
    },
  },

  cards: {
    name: "Cards (2-up)", icon: "◫",
    defaults: {
      emoji1: "🎥", title1: "Workshop Recording", action1: "Watch", href1: "https://",
      emoji2: "🗂️", title2: "FigJam Board",       action2: "Open",  href2: "https://",
      accent: "yellow",
    },
    fields: [
      { key: "emoji1",  label: "Card 1 — emoji / icon", type: "text" },
      { key: "title1",  label: "Card 1 — title", type: "text" },
      { key: "action1", label: "Card 1 — button label", type: "text" },
      { key: "href1",   label: "Card 1 — link", type: "text", placeholder: "https://…" },
      { key: "emoji2",  label: "Card 2 — emoji / icon (blank = single card)", type: "text" },
      { key: "title2",  label: "Card 2 — title", type: "text" },
      { key: "action2", label: "Card 2 — button label", type: "text" },
      { key: "href2",   label: "Card 2 — link", type: "text", placeholder: "https://…" },
      { key: "accent",  label: "Button color", type: "swatch" },
    ],
    render: (d, t) => {
      const fill = ACCENTS[d.accent] || t.yellow;
      const fg = ON_ACCENT[d.accent] || "#1A1A1A";
      // one card's inner table — fills the width of its column
      const card = (emoji, title, action, href) => {
        if (!title && !emoji && !action) return "";
        const ico = emoji
          ? `<div style="font-size:30px;line-height:1;">${esc(emoji)}</div>`
          : "";
        const ttl = title
          ? `<div style="font-family:${t.sans};font-weight:700;font-size:19px;line-height:1.3;color:${t.white};margin:18px 0 0;">${esc(title)}</div>`
          : "";
        let btn = "";
        if (action) {
          const inner = `<a href="${esc(href || "#")}" target="_blank" style="display:inline-block;padding:13px 30px;font-family:${t.sans};font-size:15px;font-weight:700;letter-spacing:0.01em;color:${fg};text-decoration:none;border-radius:6px;">${esc(action)} &rarr;</a>`;
          btn = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:22px auto 0;"><tr><td bgcolor="${fill}" style="border-radius:6px;">${inner}</td></tr></table>`;
        }
        return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${t.surface}" style="background:${t.surface};border-radius:12px;"><tr><td align="center" style="padding:34px 24px 32px;">${ico}${ttl}${btn}</td></tr></table>`;
      };
      const c1 = card(d.emoji1, d.title1, d.action1, d.href1);
      const c2 = card(d.emoji2, d.title2, d.action2, d.href2);
      // single card → full width; otherwise two columns with a gutter that
      // collapses to stacked, full-width cards under 600px (see .card-col CSS).
      const grid = c2
        ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
             <td class="card-col" width="50%" valign="top" style="padding-right:9px;">${c1}</td>
             <td class="card-col" width="50%" valign="top" style="padding-left:9px;">${c2}</td>
           </tr></table>`
        : c1;
      return row(grid, 14, 14);
    },
  },

  button: {
    name: "Button / CTA", icon: "▭",
    defaults: { label: "Enter", href: "https://", accent: "teal" },
    fields: [
      { key: "label", label: "Button label", type: "text" },
      { key: "href",  label: "Link URL", type: "text", placeholder: "https://…" },
      { key: "accent", label: "Color", type: "swatch" },
    ],
    render: (d, t) => {
      const fill = ACCENTS[d.accent] || t.teal;
      const fg = ON_ACCENT[d.accent] || "#ffffff";
      return row(
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
           <td bgcolor="${fill}" style="border-radius:6px;">
             <a href="${esc(d.href)}" target="_blank" style="display:inline-block;padding:15px 34px;font-family:${t.sans};font-size:14px;font-weight:600;letter-spacing:0.02em;color:${fg};text-decoration:none;border-radius:6px;">${esc(d.label)}</a>
           </td>
         </tr></table>`,
        14, 14
      );
    },
  },

  divider: {
    name: "Divider", icon: "─",
    defaults: {},
    fields: [],
    render: (d, t) => row(
      `<div style="border-top:1px solid ${t.border};font-size:0;line-height:0;">&nbsp;</div>`,
      18, 18
    ),
  },

  spacer: {
    name: "Spacer", icon: "↕",
    defaults: { size: "32" },
    fields: [{ key: "size", label: "Height (px)", type: "number" }],
    render: (d, t) => `<tr><td style="font-size:0;line-height:0;height:${parseInt(d.size) || 32}px;">&nbsp;</td></tr>`,
  },

  footer: {
    name: "Footer", icon: "▁",
    defaults: { left: "© 2026 BIZACUMEN", right: "INTERNAL · COHORT 04" },
    fields: [
      { key: "left",  label: "Left label", type: "text" },
      { key: "right", label: "Right label", type: "text" },
    ],
    render: (d, t) => {
      const s = `font-family:${t.sans};font-size:11px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:${t.muted};`;
      return row(
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
           <td align="left" style="${s}">${esc(d.left)}</td>
           <td align="right" style="${s}">${esc(d.right)}</td>
         </tr></table>`,
        40, 48,
        `border-top:1px solid ${t.border};`
      );
    },
  },
};

const ORDER = ["masthead","hero","lead","heading","paragraph","stat","tags","quote","notecard","callout","callouts","cards","image","button","divider","spacer","footer"];

/* ---------------------------------------------------------------------
   State
   --------------------------------------------------------------------- */
const STORE_KEY = "ccc-newsletter-builder-v1";
let state = load() || templateSpringIssue();
let selectedId = state.blocks[0]?.id || null;

function newBlock(type) {
  return { id: uid(), type, data: structuredClone(DEFS[type].defaults) };
}
function sample() {
  return {
    settings: {
      subject: "The business of design — Vol. 04",
      preheader: "A practice tool for designers learning to speak the language of business.",
    },
    blocks: [
      newBlock("masthead"),
      newBlock("hero"),
      newBlock("lead"),
      { id: uid(), type: "button", data: { label: "Start this week’s drill", href: "https://", accent: "teal" } },
      newBlock("divider"),
      { id: uid(), type: "heading", data: { eyebrow: "THIS ISSUE", text: "Reading the room — and the balance sheet." } },
      { id: uid(), type: "paragraph", data: { text: "Most design decisions are business decisions wearing a portfolio. This issue breaks down how to frame your work in the language stakeholders already speak: margin, retention, and risk.\n\nWork through the drill, then compare your framing with the cohort." } },
      { id: uid(), type: "tags", data: { items: "Strategy, Pricing, Retention", type: "info", icon: "on" } },
      newBlock("stat"),
      { id: uid(), type: "callout", data: { type: "tip", tag: "", title: "Key takeaway", text: "Frame design decisions in the language stakeholders already speak: margin, retention, and risk.", action: "Start the drill", href: "" } },
      newBlock("quote"),
      newBlock("footer"),
    ],
  };
}
// A complete, polished newsletter template — a real "Business Acumen" issue
// using the full component set and the CCC design system.
function templateSpringIssue() {
  const b = (type, data) => ({ id: uid(), type, data });
  return {
    settings: {
      subject: "The Business of Design — Vol. 04: Reading the Balance Sheet",
      preheader: "Three moves to frame your design work in the language of margin, retention, and risk.",
    },
    blocks: [
      b("masthead", { issue: "VOL. 04 · SPRING 2026", section: "BUSINESS ACUMEN" }),
      b("hero", { text: "The business of design.", emphasis: "design.", accent: "yellow" }),
      b("lead", { text: "A practice tool for designers learning to speak the language of business — one issue, one drill, one balance sheet at a time." }),
      b("tags", { items: "Strategy, Pricing, Stakeholders", type: "info", icon: "off" }),
      b("button", { label: "Start this week’s drill", href: "https://bizacumen.example/drill", accent: "teal" }),
      b("divider", {}),

      b("heading", { eyebrow: "THIS ISSUE", text: "Reading the room — and the balance sheet." }),
      b("paragraph", { text: "Most design decisions are business decisions wearing a portfolio. This issue breaks down how to frame your work in the language stakeholders already speak: margin, retention, and risk.\n\nWork through the drill below, then compare your framing with the rest of the cohort in your Local Design Jam." }),
      b("stat", { value: "73%", label: "of designers can’t read a P&L — yet", accent: "yellow" }),
      b("callout", { type: "tip", tag: "", title: "Key takeaway", text: "Frame every design decision as a business decision: what it protects, what it grows, and what it de-risks.", action: "Read the full breakdown", href: "https://bizacumen.example/takeaway" }),
      b("quote", { text: "Design is the silent ambassador of your brand.", cite: "Paul Rand" }),
      b("divider", {}),

      b("heading", { eyebrow: "DRILL 04", text: "The S-model: three moves for every kickoff." }),
      b("paragraph", { text: "Before you open the canvas, practice uncovering business context. Run these three moves in your next kickoff and note what changes about the brief." }),
      b("tags", { items: "Diagnose, Stakeholder, Deliver", type: "success", icon: "off" }),
      b("callout", { type: "resource", tag: "", title: "Workshop this Thursday", text: "Tune in to your Local Design Jam for the follow-up workshop on measuring business value.", action: "Add to calendar", href: "https://bizacumen.example/calendar" }),
      b("button", { label: "Submit your drill", href: "https://bizacumen.example/submit", accent: "yellow" }),

      b("footer", { left: "© 2026 BIZACUMEN", right: "INTERNAL · COHORT 04" }),
    ],
  };
}

// A second, fully-written issue — composed from the blocks. Showcases the
// tip / resource / warning callout types, two tag rows, a stat and a quote.
function templateSummerIssue() {
  const b = (type, data) => ({ id: uid(), type, data });
  return {
    settings: {
      subject: "The Business of Design — Vol. 05: The Redesign That Paid for Itself",
      preheader: "CAC, LTV, payback — the three numbers that turn a redesign into a budget line.",
    },
    blocks: [
      b("masthead", { issue: "VOL. 05 · SUMMER 2026", section: "BUSINESS ACUMEN" }),
      b("hero", { text: "Follow the money.", emphasis: "money.", accent: "yellow" }),
      b("lead", { text: "Every redesign has a price and a payback. This issue gives you the three numbers that turn “it looks better” into “it earns more.”" }),
      b("tags", { items: "Unit Economics, CAC, LTV", type: "info", icon: "off" }),
      b("button", { label: "Open Drill 05", href: "https://bizacumen.example/drill-05", accent: "teal" }),
      b("divider", {}),

      b("heading", { eyebrow: "THIS ISSUE", text: "The three numbers behind every redesign." }),
      b("paragraph", { text: "When you pitch a redesign, leadership hears a cost. Your job is to translate craft into the language of return: how much it costs to win a customer (CAC), how much that customer is worth over time (LTV), and how fast the spend pays back.\n\nGet fluent in these three and you stop defending pixels — you start defending margin." }),
      b("stat", { value: "3.1×", label: "median LTV:CAC ratio of teams that test pricing", accent: "yellow" }),
      b("callout", { type: "tip", tag: "", title: "Key takeaway", text: "A redesign that lifts conversion by even 1% changes CAC for every channel at once. Frame the win per-acquisition, not per-screen.", action: "See the worked example", href: "https://bizacumen.example/example" }),
      b("quote", { text: "Price is what you pay. Value is what you get.", cite: "Warren Buffett" }),
      b("divider", {}),

      b("heading", { eyebrow: "DRILL 05", text: "Put a number on your last project." }),
      b("paragraph", { text: "Take a project you shipped this year. Estimate the before/after conversion, multiply by traffic and average order value, and annualize it. Bring the number — not the screens — to your next review." }),
      b("tags", { items: "Estimate, Annualize, Defend", type: "success", icon: "off" }),
      b("callout", { type: "warning", tag: "", title: "Watch the denominator", text: "A flashy conversion lift on tiny traffic is noise. State the sample size before you state the win.", action: "", href: "" }),
      b("callout", { type: "resource", tag: "", title: "Office hours this Friday", text: "Bring your number to the Local Design Jam. We’ll pressure-test the assumptions together and sharpen the story.", action: "Reserve a slot", href: "https://bizacumen.example/office-hours" }),
      b("button", { label: "Submit your number", href: "https://bizacumen.example/submit", accent: "yellow" }),

      b("footer", { left: "© 2026 BIZACUMEN", right: "INTERNAL · COHORT 05" }),
    ],
  };
}

// Loadable templates (shown in the topbar picker)
const TEMPLATES = {
  spring:  { label: "Business Acumen — Spring Issue", build: templateSpringIssue },
  summer:  { label: "Business Acumen — Summer Issue", build: templateSummerIssue },
  sample:  { label: "Basic sample", build: sample },
};

function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch {} }
function load() { try { return JSON.parse(localStorage.getItem(STORE_KEY)); } catch { return null; } }

/* ---------------------------------------------------------------------
   Email document builder
   --------------------------------------------------------------------- */
function buildEmail(s) {
  const t = THEME;
  const body = s.blocks.map(b => DEFS[b.type].render(b.data, t)).join("\n");
  const pre = esc(s.settings.preheader || "");
  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="x-apple-disable-message-reformatting" />
<title>${esc(s.settings.subject || "Newsletter")}</title>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;1,9..144,400&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
<style>
  body { margin:0; padding:0; background:${t.bg}; }
  img { -ms-interpolation-mode:bicubic; }
  a { color:${t.yellow}; }
  @media only screen and (max-width:600px) {
    .container { width:100% !important; }
    .px { padding-left:24px !important; padding-right:24px !important; }
    .hero { font-size:42px !important; }
    .card-col { display:block !important; width:100% !important; padding:0 0 14px 0 !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${t.bg};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${t.bg};font-size:1px;line-height:1px;">${pre}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${t.bg}" style="background:${t.bg};">
  <tr>
    <td align="center" style="padding:0 16px;">
      <table role="presentation" class="container" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:680px;background:${t.bg};">
${body}
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

/* ---------------------------------------------------------------------
   Render: editor panel
   --------------------------------------------------------------------- */
function renderPalette() {
  const pal = $("#palette");
  pal.innerHTML = ORDER.map(type =>
    `<button class="btn btn-outline" data-add="${type}"><span class="ico">${DEFS[type].icon}</span>${DEFS[type].name}</button>`
  ).join("");
}

function fieldHTML(block, f) {
  const v = block.data[f.key] ?? "";
  const id = `${block.id}-${f.key}`;
  if (f.type === "textarea") {
    return `<div class="field">
      <label class="lbl" for="${id}">${f.label}</label>
      <textarea class="textarea" id="${id}" data-block="${block.id}" data-key="${f.key}" placeholder="${esc(f.placeholder||"")}">${esc(v)}</textarea>
    </div>`;
  }
  if (f.type === "swatch") {
    const opts = Object.keys(ACCENTS).map(c =>
      `<button type="button" class="swatch ${v===c?"active":""}" style="background:${ACCENTS[c]}" title="${c}" data-block="${block.id}" data-key="${f.key}" data-val="${c}"></button>`
    ).join("");
    return `<div class="field"><label class="lbl">${f.label}</label><div class="swatches">${opts}</div></div>`;
  }
  if (f.type === "select") {
    const opts = f.options.map(o =>
      `<option value="${esc(o.value)}" ${v===o.value?"selected":""}>${esc(o.label)}</option>`
    ).join("");
    return `<div class="field">
      <label class="lbl" for="${id}">${f.label}</label>
      <select class="select" id="${id}" data-block="${block.id}" data-key="${f.key}">${opts}</select>
    </div>`;
  }
  if (f.type === "image") {
    // value may be a pasted URL or an embedded data: URI from an upload
    const uploaded = typeof v === "string" && v.startsWith("data:");
    const urlVal = uploaded ? "" : v;
    const status = uploaded
      ? `<span style="font-size:12px;color:${THEME.yellow};">✓ uploaded</span>
         <button type="button" class="link-btn" data-clear-img data-block="${block.id}" data-key="${f.key}" style="background:none;border:0;color:${THEME.muted};font-size:12px;cursor:pointer;padding:0;text-decoration:underline;">remove</button>`
      : "";
    return `<div class="field">
      <label class="lbl" for="${id}">${f.label}</label>
      <input class="input" type="text" id="${id}" data-block="${block.id}" data-key="${f.key}" value="${esc(urlVal)}" placeholder="${esc(f.placeholder||"https://…")}" />
      <div style="display:flex;align-items:center;gap:10px;margin-top:8px;">
        <label class="btn btn-outline" style="margin:0;cursor:pointer;">Upload image…<input type="file" accept="image/*" data-upload="1" data-block="${block.id}" data-key="${f.key}" style="display:none;" /></label>
        ${status}
      </div>
    </div>`;
  }
  const type = f.type === "number" ? "number" : "text";
  return `<div class="field">
    <label class="lbl" for="${id}">${f.label}</label>
    <input class="input" type="${type}" id="${id}" data-block="${block.id}" data-key="${f.key}" value="${esc(v)}" placeholder="${esc(f.placeholder||"")}" />
  </div>`;
}

// Read an uploaded file, downscale to maxW, and return a data: URI via cb().
// Keeps PNG/transparency; re-encodes everything else as JPEG to keep size sane
// (big images otherwise blow the localStorage quota and bloat the email).
function fileToDataUrl(file, maxW, cb) {
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      let w = img.width, h = img.height;
      if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d");
      const keep = /png|gif|webp|svg/i.test(file.type);
      if (!keep) { ctx.fillStyle = THEME.bg; ctx.fillRect(0, 0, w, h); } // flatten onto theme bg
      ctx.drawImage(img, 0, 0, w, h);
      try { cb(canvas.toDataURL(keep ? "image/png" : "image/jpeg", 0.85)); }
      catch { cb(reader.result); } // tainted/unsupported → use original
    };
    img.onerror = () => cb(reader.result);
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

function renderBlocks() {
  const wrap = $("#blocks");
  if (!state.blocks.length) {
    wrap.innerHTML = `<div class="empty-hint">No blocks yet.<br>Add one from the palette above.</div>`;
    return;
  }
  wrap.innerHTML = state.blocks.map((b, i) => {
    const def = DEFS[b.type];
    const fields = def.fields.map(f => fieldHTML(b, f)).join("") ||
      `<p style="margin:0;color:var(--muted-foreground);font-size:13px;">No options for this block.</p>`;
    return `<div class="block-card ${b.id===selectedId?"selected":""}" data-id="${b.id}">
      <div class="block-head" data-select="${b.id}">
        <button class="mini handle" data-handle title="Drag to reorder" aria-label="Drag to reorder">⠿</button>
        <span class="type"><span class="badge">${def.icon}</span>${def.name}</span>
        <span class="grow"></span>
        <button class="mini" data-move="up"   data-id="${b.id}" ${i===0?"disabled":""} title="Move up">↑</button>
        <button class="mini" data-move="down" data-id="${b.id}" ${i===state.blocks.length-1?"disabled":""} title="Move down">↓</button>
        <button class="mini" data-dup="${b.id}" title="Duplicate">⧉</button>
        <button class="mini danger" data-del="${b.id}" title="Delete">✕</button>
      </div>
      <div class="block-body">${fields}</div>
    </div>`;
  }).join("");
}

// full design-system palette, grouped, rendered as click-to-copy chips
const PALETTE_GROUPS = [
  { name: "Accents", colors: [
    ["Teal", "teal"], ["Blue", "blue"], ["Purple", "purple"],
    ["Pink", "pink"], ["Orange", "orange"], ["Yellow", "yellow"],
  ] },
  { name: "Base colors", colors: [
    ["Black", "bg"], ["Dark Gray", "darkGray"], ["Medium Gray", "mediumGray"],
    ["Light Gray", "lightGray"], ["White", "white"],
  ] },
];
function renderPaletteRef() {
  const el = $("#paletteRef");
  el.innerHTML = PALETTE_GROUPS.map(g => `
    <div class="group">
      <span class="group-name">${g.name}</span>
      <div class="swatch-grid">
        ${g.colors.map(([nm, key]) => {
          const hex = THEME[key];
          return `<button type="button" class="chip" data-copy-hex="${hex}" title="Copy ${hex}">
            <span class="dot" style="background:${hex}"></span>
            <span class="meta"><span class="nm">${nm}</span><span class="hex">${hex}</span></span>
          </button>`;
        }).join("")}
      </div>
    </div>`).join("");
}

function renderPreview() {
  const frame = $("#previewFrame");
  const doc = frame.contentDocument || frame.contentWindow.document;
  doc.open(); doc.write(buildEmail(state)); doc.close();
}

function renderSettings() {
  $$("[data-setting]").forEach(el => { el.value = state.settings[el.dataset.setting] || ""; });
}

function renderAll() {
  renderBlocks();
  renderPreview();
  save();
}

/* ---------------------------------------------------------------------
   Events
   --------------------------------------------------------------------- */
function findIndex(id) { return state.blocks.findIndex(b => b.id === id); }

document.addEventListener("click", (e) => {
  const chip = e.target.closest("[data-copy-hex]");
  if (chip) { copyText(chip.dataset.copyHex); return; }

  const clr = e.target.closest("[data-clear-img]");
  if (clr) {
    const b = state.blocks[findIndex(clr.dataset.block)];
    if (b) { b.data[clr.dataset.key] = ""; renderBlocks(); renderPreview(); save(); }
    return;
  }

  const t = e.target.closest("[data-add],[data-select],[data-move],[data-del],[data-dup],[data-val]");
  if (!t) return;

  if (t.dataset.add) {
    const blk = newBlock(t.dataset.add);
    const at = selectedId ? findIndex(selectedId) + 1 : state.blocks.length;
    state.blocks.splice(at, 0, blk);
    selectedId = blk.id;
    renderAll();
  } else if (t.dataset.select) {
    selectedId = selectedId === t.dataset.select ? null : t.dataset.select;
    renderBlocks();
  } else if (t.dataset.move) {
    const i = findIndex(t.dataset.id);
    const j = t.dataset.move === "up" ? i - 1 : i + 1;
    if (j < 0 || j >= state.blocks.length) return;
    [state.blocks[i], state.blocks[j]] = [state.blocks[j], state.blocks[i]];
    renderAll();
  } else if (t.dataset.dup) {
    const i = findIndex(t.dataset.dup);
    const copy = { id: uid(), type: state.blocks[i].type, data: structuredClone(state.blocks[i].data) };
    state.blocks.splice(i + 1, 0, copy);
    selectedId = copy.id;
    renderAll();
  } else if (t.dataset.del) {
    state.blocks = state.blocks.filter(b => b.id !== t.dataset.del);
    if (selectedId === t.dataset.del) selectedId = null;
    renderAll();
  } else if (t.dataset.val) {
    const b = state.blocks[findIndex(t.dataset.block)];
    if (b) { b.data[t.dataset.key] = t.dataset.val; renderAll(); }
  }
});

// image upload → embed a downscaled data: URI into the block
document.addEventListener("change", (e) => {
  const el = e.target;
  if (!el.dataset.upload || !el.files || !el.files[0]) return;
  const b = state.blocks[findIndex(el.dataset.block)];
  if (!b) return;
  const key = el.dataset.key;
  fileToDataUrl(el.files[0], 1200, (out) => {
    b.data[key] = out;
    renderBlocks(); renderPreview(); save();
  });
});

// live field edits (input updates preview without losing focus)
document.addEventListener("input", (e) => {
  const el = e.target;
  if (el.dataset.setting) {
    state.settings[el.dataset.setting] = el.value;
    renderPreview(); save(); return;
  }
  if (el.dataset.block && el.dataset.key) {
    const b = state.blocks[findIndex(el.dataset.block)];
    if (b) { b.data[el.dataset.key] = el.value; renderPreview(); save(); }
  }
});

/* ----- Drag & drop reordering -------------------------------------- */
// Dragging is "armed" only via the handle so inputs/textareas stay editable.
let armedCard = null;   // card made draggable by a handle mousedown
let dragId = null;      // id of the block currently being dragged

const blocksEl = $("#blocks");

function disarm() {
  if (armedCard) { armedCard.draggable = false; armedCard = null; }
}
function clearMarkers() {
  $$(".block-card", blocksEl).forEach(c => c.classList.remove("drop-before", "drop-after", "dragging"));
}

blocksEl.addEventListener("mousedown", (e) => {
  const handle = e.target.closest("[data-handle]");
  if (!handle) return;
  const card = handle.closest(".block-card");
  if (!card) return;
  disarm();
  armedCard = card;
  card.draggable = true;
});
document.addEventListener("mouseup", disarm);

blocksEl.addEventListener("dragstart", (e) => {
  const card = e.target.closest(".block-card");
  if (!card || !card.draggable) { e.preventDefault(); return; }
  dragId = card.dataset.id;
  card.classList.add("dragging");
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", dragId);
});

blocksEl.addEventListener("dragover", (e) => {
  if (dragId == null) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  const over = e.target.closest(".block-card");
  $$(".block-card", blocksEl).forEach(c => c.classList.remove("drop-before", "drop-after"));
  if (!over || over.dataset.id === dragId) return;
  const r = over.getBoundingClientRect();
  const after = e.clientY > r.top + r.height / 2;
  over.classList.add(after ? "drop-after" : "drop-before");
});

blocksEl.addEventListener("drop", (e) => {
  if (dragId == null) return;
  e.preventDefault();
  const over = e.target.closest(".block-card");
  const from = findIndex(dragId);
  if (over && over.dataset.id !== dragId && from >= 0) {
    const r = over.getBoundingClientRect();
    const after = e.clientY > r.top + r.height / 2;
    let to = findIndex(over.dataset.id) + (after ? 1 : 0);
    const [moved] = state.blocks.splice(from, 1);
    if (from < to) to--;             // account for the removed item
    state.blocks.splice(to, 0, moved);
    selectedId = dragId;
    renderAll();
  }
  dragId = null;
});

blocksEl.addEventListener("dragend", () => {
  dragId = null;
  clearMarkers();
  disarm();
});

// viewport toggle
$("#viewport").addEventListener("click", (e) => {
  const btn = e.target.closest("button"); if (!btn) return;
  $$("#viewport button").forEach(b => b.classList.toggle("active", b === btn));
  $("#previewScroll").dataset.w = btn.dataset.w;
});

// topbar actions — template picker
(function initTemplatePicker() {
  const sel = $("#templatePicker");
  sel.innerHTML = `<option value="" disabled selected>Load template…</option>` +
    Object.entries(TEMPLATES).map(([k, t]) => `<option value="${k}">${esc(t.label)}</option>`).join("");
  sel.addEventListener("change", () => {
    const tpl = TEMPLATES[sel.value];
    if (!tpl) return;
    state = tpl.build();
    selectedId = state.blocks[0]?.id || null;
    renderSettings(); renderAll();
    toast(`${tpl.label} loaded`);
    sel.value = "";
  });
})();
$("#btnReset").addEventListener("click", () => {
  if (!confirm("Clear all blocks and settings?")) return;
  state = { settings: { subject: "", preheader: "" }, blocks: [] };
  selectedId = null; renderSettings(); renderAll(); toast("Cleared");
});

// ---- Sending ---------------------------------------------------------
// Fixed sender. The backend sends via the Gmail API as this account
// (server env MAIL_FROM), so this is shown for reference and isn't editable.
const SEND_FROM = "mensch.vagner@gmail.com";
// Backend endpoint that actually delivers the mail (e.g. nodemailer / an
// email API). Override via window.SEND_ENDPOINT before app.js loads.
const SEND_ENDPOINT = (typeof window !== "undefined" && window.SEND_ENDPOINT) || "/api/send";

function openSend() {
  $("#sendFrom").value = SEND_FROM;
  $("#sendSubject").value = state.settings.subject || "";
  if (!$("#sendTo").value) $("#sendTo").value = localStorage.getItem("ccc-nl-recipients") || "";
  $("#exportCode").value = buildEmail(state);
  $("#exportDialog").classList.add("open");
}
$("#btnSend").addEventListener("click", openSend);
$("#btnCloseDialog").addEventListener("click", () => $("#exportDialog").classList.remove("open"));
$("#exportDialog").addEventListener("click", (e) => { if (e.target.id === "exportDialog") e.currentTarget.classList.remove("open"); });

function parseRecipients(raw) {
  return (raw || "").split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
}
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const btnSendNow = $("#btnSendNow");
$("#btnSendNow").addEventListener("click", async () => {
  const from = $("#sendFrom").value.trim();
  const to = parseRecipients($("#sendTo").value);
  const subject = $("#sendSubject").value.trim();
  if (from && !EMAIL_RE.test(from)) { toast("From isn’t a valid email address"); $("#sendFrom").focus(); return; }
  if (!to.length) { toast("Add at least one recipient"); $("#sendTo").focus(); return; }
  const bad = to.find(a => !EMAIL_RE.test(a));
  if (bad) { toast(`Invalid email: ${bad}`); $("#sendTo").focus(); return; }
  if (!subject) { toast("Add a subject"); $("#sendSubject").focus(); return; }

  localStorage.setItem("ccc-nl-recipients", to.join(", "));
  if (from) localStorage.setItem("ccc-nl-from", from);
  // `from` is optional — server falls back to its configured sender if blank.
  const payload = { from, to, subject, html: buildEmail(state) };

  btnSendNow.disabled = true;
  const label = btnSendNow.textContent;
  btnSendNow.textContent = "Sending…";
  try {
    const headers = { "Content-Type": "application/json" };

    const res = await fetch(SEND_ENDPOINT, {
      method: "POST",
      headers,
      credentials: "same-origin",
      body: JSON.stringify(payload),
    });
    if (res.status === 503) { toast("Email service isn’t configured yet"); return; }
    if (res.status === 429) { toast("Too many sends — wait a minute and try again"); return; }
    if (!res.ok) { let m = "Send failed, please try again"; try { m = (await res.json()).error || m; } catch {} toast(m); return; }
    const data = await res.json().catch(() => ({}));
    toast(`Sent to ${data.count ?? to.length} recipient${(data.count ?? to.length) > 1 ? "s" : ""}`);
    $("#exportDialog").classList.remove("open");
  } catch (err) {
    // Network error / no backend (e.g. static hosting) → guide the user, keep their work.
    toast("Couldn’t reach the send service — download/copy the HTML instead");
    console.warn(`Send failed (${SEND_ENDPOINT}):`, err);
  } finally {
    btnSendNow.disabled = false;
    btnSendNow.textContent = label;
  }
});

function copyText(text) {
  navigator.clipboard?.writeText(text).then(() => toast("Copied to clipboard"))
    .catch(() => toast("Copy failed — select & copy manually"));
}
$("#btnCopyDialog").addEventListener("click", () => copyText(buildEmail(state)));
$("#btnCopyQuick").addEventListener("click", () => copyText(buildEmail(state)));
$("#btnDownload").addEventListener("click", () => {
  const blob = new Blob([buildEmail(state)], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const name = (state.settings.subject || "newsletter").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "newsletter";
  a.href = url; a.download = `${name}.html`; a.click();
  URL.revokeObjectURL(url); toast("Downloaded");
});

/* ---------------------------------------------------------------------
   Shareable link — encodes the whole newsletter into the URL (no server).
   Opening the link loads that exact newsletter; the recipient can read it
   and keep editing (their changes then save locally as usual).
   --------------------------------------------------------------------- */
function bytesToB64url(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlToBytes(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function gzip(str) {
  const cs = new CompressionStream("gzip");
  const w = cs.writable.getWriter(); w.write(new TextEncoder().encode(str)); w.close();
  return new Uint8Array(await new Response(cs.readable).arrayBuffer());
}
async function gunzip(bytes) {
  const ds = new DecompressionStream("gzip");
  const w = ds.writable.getWriter(); w.write(bytes); w.close();
  return new TextDecoder().decode(await new Response(ds.readable).arrayBuffer());
}
async function makeShareLink() {
  const json = JSON.stringify(state);
  let mode = "j", payload;
  if (typeof CompressionStream !== "undefined") {
    try { payload = bytesToB64url(await gzip(json)); mode = "s"; } catch {}
  }
  if (!payload) payload = bytesToB64url(new TextEncoder().encode(json));
  return `${location.origin}${location.pathname}#${mode}=${payload}`;
}
async function stateFromHash() {
  const m = location.hash.slice(1).match(/^(s|j)=(.+)$/s);
  if (!m) return null;
  try {
    const bytes = b64urlToBytes(m[2]);
    const json = m[1] === "s" ? await gunzip(bytes) : new TextDecoder().decode(bytes);
    const obj = JSON.parse(json);
    if (obj && Array.isArray(obj.blocks) && obj.settings) return obj;
  } catch {}
  return null;
}
$("#btnShare").addEventListener("click", async () => {
  const btn = $("#btnShare");
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = "Saving…";
  try {
    // Save server-side (Netlify Blobs) → short link, even with embedded images.
    const res = await fetch("/api/save", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(state),
    });
    if (!res.ok) throw new Error("save failed");
    const { id } = await res.json();
    const link = `${location.origin}${location.pathname}?id=${id}`;
    await navigator.clipboard.writeText(link);
    toast("Share link copied to clipboard");
  } catch {
    // Fallback: encode into the URL hash (works without the server).
    try {
      const link = await makeShareLink();
      await navigator.clipboard.writeText(link);
      toast("Link copied (offline mode — server unavailable)");
    } catch { toast("Could not create link"); }
  } finally {
    btn.disabled = false; btn.textContent = label;
  }
});

let toastTimer;
function toast(msg) {
  const el = $("#toast"); el.textContent = msg; el.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("show"), 1800);
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") $("#exportDialog").classList.remove("open");
});

/* ---------------------------------------------------------------------
   Boot
   --------------------------------------------------------------------- */
renderPalette();
renderPaletteRef();
renderSettings();
renderAll();

// If opened via a share link, load that newsletter (takes precedence over
// local storage), then strip the hash so the reader's own edits persist on
// reload instead of being overwritten by the snapshot.
(async function bootFromShareLink() {
  let shared = null;
  const id = new URLSearchParams(location.search).get("id");
  if (id) {
    try {
      const res = await fetch(`/api/load?id=${encodeURIComponent(id)}`);
      if (res.ok) {
        const obj = await res.json();
        if (obj && Array.isArray(obj.blocks) && obj.settings) shared = obj;
      }
    } catch {}
  }
  if (!shared) shared = await stateFromHash(); // backward-compat for old hash links
  if (!shared) return;
  state = shared;
  selectedId = state.blocks[0]?.id || null;
  renderSettings(); renderAll();
  // Strip ?id / #hash so the reader's own edits persist on reload.
  history.replaceState(null, "", location.pathname);
  toast("Loaded shared newsletter");
})();
