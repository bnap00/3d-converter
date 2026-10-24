// Builds the static pages from templates/page.html (the converters) and templates/fins.html
// (the stabilizer fins tool). Both pull in the shared templates/_*.html partials.
// No dependencies. Run after editing the template or the page content below:
//   node tools/build.mjs
// The generated .html files are committed and deployed as-is (Vercel needs no build step).

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = "https://3d-converter.bnap.dev";
const today = new Date().toISOString().slice(0, 10);

/* ---------- FAQ content ---------- */

const faq = {
  uploaded: {
    q: "Are my files uploaded anywhere?",
    a: "No. Your CAD files are read from your disk, converted in your browser's memory and saved straight back to your disk. Nothing is sent to a server.",
  },
  types: {
    q: "Which file types can I convert?",
    a: "STEP (.step, .stp) and IGES (.iges, .igs) go in, binary STL comes out. Binary STL opens in every common slicer, including Cura, PrusaSlicer, Bambu Studio and OrcaSlicer.",
  },
  units: {
    q: "What units does the STL use?",
    a: "STL files have no units. This tool exports in millimetres, which is what slicers assume, so parts load at the right size.",
  },
  quality: {
    q: "What do Draft, Standard and Fine mean?",
    a: "They set how closely the triangles follow curved surfaces: within 0.2 mm, 0.05 mm or 0.01 mm. Standard suits most FDM and resin prints. Use Fine for small parts with tight curves.",
  },
  bodies: {
    q: 'What does "One STL per body" do?',
    a: "By default an assembly becomes a single STL. Turn this on to get a separate STL for each body, grouped in a folder named after the source file.",
  },
  stpSame: {
    q: "Is STP the same as STEP?",
    a: 'Yes. .stp and .step are two file extensions for the same format (ISO 10303, often called STEP AP203, AP214 or AP242). Both work here, and there is a page just for <a href="/stp-to-stl">STP to STL</a>.',
  },
  stpPrograms: {
    q: "Which programs export STP files?",
    a: "Almost every CAD program: SolidWorks, Fusion 360, Onshape, FreeCAD, Inventor, CATIA, Creo and more. Look for STEP or STP in the export or Save As menu.",
  },
  igesWhat: {
    q: "What is an IGES file?",
    a: "IGES (Initial Graphics Exchange Specification) is an older neutral CAD format saved as .igs or .iges. Many older CAD systems and machining workflows still export it.",
  },
  igesGaps: {
    q: "Why does my IGES file convert with holes?",
    a: "IGES files often contain separate surfaces instead of closed solids. They still convert, but the STL can have small gaps. If your slicer reports holes, use its repair tool, or export STEP from the original CAD program instead.",
  },
  igesVsStep: {
    q: "Should I use STEP or IGES?",
    a: 'If you can choose, export STEP. It keeps solids and assembly structure more reliably, and it converts with the <a href="/">STEP to STL converter</a> on this site.',
  },
  back: {
    q: "Can I convert STL back to STEP?",
    a: "Not with this tool. STL only stores triangles, so the exact curves and features of the original CAD model are lost. Keep your STEP or IGES file as the master copy.",
  },
  size: {
    q: "Is there a file size limit?",
    a: "There is no fixed limit, but very large assemblies can run out of browser memory. If a file fails, try Draft quality or convert it on its own.",
  },
  free: {
    q: "Is it really free?",
    a: "Yes. No account, no watermark and no limit on the number of files.",
  },
  finsWhat: {
    q: "What are stabilizer fins?",
    a: "Thin vertical plates printed next to a tall, narrow part, joined to it by tiny one-layer bridges called tines. They widen the base so the part cannot be knocked over by the nozzle or the bed moving, and they snap off cleanly once the print is done.",
  },
  finsWhy: {
    q: "Why not use a brim or slicer supports?",
    a: "A brim only helps the first layer stick. It does nothing once the part is 50 mm tall and the nozzle catches the top. Slicer supports sit under overhangs and do not touch the sides of a part. Fins tie the sides to a wide footprint all the way up, and because they are part of the STL they work in any slicer.",
  },
  finsRemove: {
    q: "How do I remove the fins?",
    a: "Bend each fin away from the part. The tines are one layer tall and only bridge a 0.2 mm gap, so they break at the part's surface and leave small marks. A flush cutter or a light sand cleans up what is left.",
  },
  finsLayer: {
    q: "Why does the tine height need to match my layer height?",
    a: "A tine is meant to print as a single line. If it is taller or shorter than one layer, the slicer splits it across two layers or drops it, and it stops holding the part. Set Layer height to the value in your slicer before you download.",
  },
  finsSlicer: {
    q: "Which slicers work with the result?",
    a: "Any slicer that opens STL: Cura, PrusaSlicer, Bambu Studio, OrcaSlicer and others. The fins are separate closed shells in the same STL, and the slicer merges them with the part. Do not split the STL into objects, or the tines will no longer touch the part.",
  },
  finsFiles: {
    q: "Which files can I add fins to?",
    a: 'STL, STEP and IGES. STEP and IGES files are converted to a mesh in your browser first, the same way as on the <a href="/">STEP to STL converter</a>. Nothing is uploaded.',
  },
  finsIdea: {
    q: "Where does the idea come from?",
    a: 'Designed-in support fins were popularised by Slant3D, and <a href="https://printfins.com" rel="noopener">Support Fins</a> builds them under overhangs. This tool uses the same breakaway gap and one-layer tines, but stands the fins beside a tall part to stop it tipping over.',
  },
  finsPlace: {
    q: "Can I choose where the fins go?",
    a: "Yes. The tool suggests fins on both thin sides of the part, but you can drag each one along the part, change its height, delete it, or click anywhere on the part to add another.",
  },
};

/* ---------- Pages ---------- */

const pages = [
  {
    file: "index.html",
    path: "/",
    nav: "STEP to STL",
    title: "STEP to STL Converter: Free, Bulk, No Upload | 3D Converter",
    description: "Convert STEP and IGES files to STL for 3D printing, in bulk and for free. Everything runs in your browser, so your CAD files are never uploaded.",
    ogTitle: "Free Bulk STEP to STL Converter",
    ogDescription: "Convert STEP and IGES files to STL in your browser. Bulk, free, and nothing gets uploaded.",
    ogImage: "og-image.png",
    appName: "3D Converter: STEP to STL",
    eyebrow: "Free, no sign-up",
    h1: "Bulk STEP to STL converter",
    lede: "Drop in as many STEP or IGES files as you like. Everything converts in your browser, and nothing gets uploaded.",
    dropTitle: "Drop STEP or IGES files here",
    howtoTitle: "How to convert STEP to STL",
    howtoIntro: "STEP is the standard format for sharing CAD models. Slicers need a triangle mesh instead, which is what STL stores. This tool does the conversion on your own computer.",
    howtoAdd: "Drop STEP (.step, .stp) or IGES (.iges, .igs) files onto the converter, or click Choose files. You can also drop a whole folder.",
    faqTitle: "STEP to STL questions",
    faq: ["uploaded", "types", "units", "quality", "bodies", "stpSame", "back", "size", "free"],
  },
  {
    file: "stp-to-stl.html",
    path: "/stp-to-stl",
    nav: "STP to STL",
    title: "STP to STL Converter: Free, Bulk, No Upload | 3D Converter",
    description: "Convert STP files to STL for 3D printing. Free bulk conversion that runs in your browser, so your CAD files are never uploaded.",
    ogTitle: "Free Bulk STP to STL Converter",
    ogDescription: "Convert .stp files to STL in your browser. Bulk, free, and nothing gets uploaded.",
    ogImage: "og-stp-to-stl.png",
    appName: "3D Converter: STP to STL",
    eyebrow: "Free, no sign-up",
    h1: "Bulk STP to STL converter",
    lede: "Drop in as many .stp files as you like. They convert in your browser, and nothing gets uploaded.",
    dropTitle: "Drop STP files here",
    howtoTitle: "How to convert STP to STL",
    howtoIntro: ".stp is the short file extension for STEP, the standard CAD exchange format, and most CAD programs save with it. Slicers cannot print it directly, so it needs converting to an STL mesh first.",
    howtoAdd: "Drop your .stp files onto the converter, or click Choose files. .step and IGES files work too, and you can drop a whole folder.",
    faqTitle: "STP to STL questions",
    faq: ["stpSame", "stpPrograms", "uploaded", "units", "quality", "bodies", "back", "size", "free"],
  },
  {
    file: "iges-to-stl.html",
    path: "/iges-to-stl",
    nav: "IGES to STL",
    title: "IGES to STL Converter: Free, Bulk, No Upload | 3D Converter",
    description: "Convert IGES and IGS files to STL for 3D printing. Free bulk conversion that runs in your browser, so your CAD files are never uploaded.",
    ogTitle: "Free Bulk IGES to STL Converter",
    ogDescription: "Convert .igs and .iges files to STL in your browser. Bulk, free, and nothing gets uploaded.",
    ogImage: "og-iges-to-stl.png",
    appName: "3D Converter: IGES to STL",
    eyebrow: "Free, no sign-up",
    h1: "Bulk IGES to STL converter",
    lede: "Drop in as many .igs or .iges files as you like. They convert in your browser, and nothing gets uploaded.",
    dropTitle: "Drop IGES files here",
    howtoTitle: "How to convert IGES to STL",
    howtoIntro: "IGES is an older neutral CAD format, saved as .igs or .iges. Many older CAD systems and machining workflows still use it. To 3D print an IGES part, it first needs converting to an STL mesh.",
    howtoAdd: "Drop your .igs or .iges files onto the converter, or click Choose files. STEP files work too, and you can drop a whole folder.",
    faqTitle: "IGES to STL questions",
    faq: ["igesWhat", "igesGaps", "igesVsStep", "uploaded", "units", "quality", "bodies", "size", "free"],
  },
  {
    file: "stabilizer-fins.html",
    template: "fins.html",
    path: "/stabilizer-fins",
    nav: "Stabilizer fins",
    group: "tools",
    title: "Stabilizer Fins for Tall, Thin 3D Prints: Free, No Upload | 3D Converter",
    description: "Stop tall, thin 3D prints from getting knocked over. Add breakaway stabilizer fins to both sides of an STL, STEP or IGES part, right in your browser.",
    ogTitle: "Stabilizer Fins for Tall, Thin Prints",
    ogDescription: "Add breakaway fins to both sides of a tall, thin part so it cannot tip over mid-print. Free, in your browser.",
    ogImage: "og-stabilizer-fins.png",
    ogImageAlt: "3D Converter: a tall, thin part with stabilizer fins on both sides, in the fins editor",
    appName: "3D Converter: Stabilizer fins",
    appScript: "/assets/fins-app.js",
    skip: ["#fins-tool", "Skip to the fins tool"],
    navLinks: [["#fins-tool", "Tool"], ["#how-it-works", "How it works"], ["#faq", "FAQ"]],
    eyebrow: "Free, no sign-up",
    h1: "Stabilizer fins for tall, thin prints",
    lede: "Tall, narrow parts get knocked over halfway through a print. Add breakaway fins to both sides, tied on with one-layer tines, and download one STL that prints in any slicer.",
    faqTitle: "Stabilizer fin questions",
    faq: ["finsWhat", "finsWhy", "finsRemove", "finsLayer", "finsPlace", "finsSlicer", "finsFiles", "finsIdea", "uploaded", "free"],
    featureList: [
      "Add stabilizer fins to STL, STEP and IGES parts",
      "Suggests fins on both thin sides of tall parts",
      "Drag, resize, add and delete fins by hand",
      "One-layer breakaway tines that grip the part",
      "Runs locally in the browser, no upload",
      "Download one STL with the fins included",
    ],
  },
];

const converterFeatures = [
  "Convert STEP (.step, .stp) to STL",
  "Convert IGES (.iges, .igs) to STL",
  "Bulk conversion with ZIP download",
  "Runs locally in the browser, no upload",
  "Draft, Standard and Fine mesh quality",
  "One STL per body for assemblies",
  "3D preview of the result",
];

/* ---------- Rendering ---------- */

const escapeAttr = (s) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const stripTags = (s) => s.replace(/<[^>]+>/g, "");
const urlOf = (p) => SITE + p.path;

const caret = '<svg class="icon" aria-hidden="true"><use href="/assets/icons-v2.svg#i-caret-down"/></svg>';
const renderFaq = (keys) =>
  keys
    .map((k) => `        <details>\n          <summary>${faq[k].q}${caret}</summary>\n          <p>${faq[k].a}</p>\n        </details>\n`)
    .join("");

const relatedGroup = (label, list, current) =>
  `<span class="related-label">${label}</span>` +
  list.map((p) => `<a href="${p.path}"${p === current ? ' aria-current="page"' : ""}>${p.nav}</a>`).join(" ");
const renderRelated = (current) =>
  relatedGroup("Converters", pages.filter((p) => !p.group), current) +
  ' <span class="related-sep" aria-hidden="true"></span>' +
  relatedGroup("Tools", pages.filter((p) => p.group === "tools"), current);

const defaultNav = [["#features", "Features"], ["#how-it-works", "How it works"], ["#faq", "FAQ"]];
const renderNav = (links) => links.map(([href, label]) => `        <a href="${href}">${label}</a>\n`).join("");

function jsonld(page) {
  const url = urlOf(page);
  const graph = [
    {
      "@type": "WebSite",
      "@id": `${SITE}/#website`,
      url: `${SITE}/`,
      name: "3D Converter",
      inLanguage: "en",
      publisher: { "@id": "https://bnap.dev/#org" },
    },
    { "@type": "Organization", "@id": "https://bnap.dev/#org", name: "bnap.dev", url: "https://bnap.dev" },
    {
      "@type": "WebApplication",
      "@id": `${url}#app`,
      name: page.appName,
      url,
      applicationCategory: "DesignApplication",
      operatingSystem: "Any",
      browserRequirements: "Requires JavaScript and WebAssembly",
      description: page.description,
      image: `${SITE}/${page.ogImage}`,
      screenshot: `${SITE}/${page.ogImage}`,
      isAccessibleForFree: true,
      inLanguage: "en",
      featureList: page.featureList || converterFeatures,
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      creator: { "@id": "https://bnap.dev/#org" },
    },
    {
      "@type": "FAQPage",
      "@id": `${url}#faq`,
      mainEntity: page.faq.map((k) => ({
        "@type": "Question",
        name: faq[k].q,
        acceptedAnswer: { "@type": "Answer", text: stripTags(faq[k].a) },
      })),
    },
  ];
  if (page.path !== "/") {
    graph.push({
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "3D Converter", item: `${SITE}/` },
        { "@type": "ListItem", position: 2, name: page.nav, item: url },
      ],
    });
  }
  // Escape "<" so answer text can never close the script tag.
  return JSON.stringify({ "@context": "https://schema.org", "@graph": graph }, null, 2).replace(/</g, "\\u003c");
}

const read = (name) => readFileSync(join(root, "templates", name), "utf8");
const partials = { head: read("_head.html"), header: read("_header.html"), footer: read("_footer.html") };

for (const page of pages) {
  const template = read(page.template || "page.html").replace(/{{>(\w+)}}\n?/g, (_, name) => {
    if (!(name in partials)) throw new Error(`Missing partial {{>${name}}} in ${page.file}`);
    return partials[name];
  });
  const values = {
    title: escapeAttr(page.title),
    description: escapeAttr(page.description),
    url: urlOf(page),
    ogTitle: escapeAttr(page.ogTitle),
    ogDescription: escapeAttr(page.ogDescription),
    ogImage: `${SITE}/${page.ogImage}`,
    ogImageAlt: escapeAttr(page.ogImageAlt || `3D Converter: bulk ${page.nav} converter, with a converted CAD assembly shown in 3D`),
    appScript: page.appScript || "/assets/app.js",
    skipHref: (page.skip || ["#converter"])[0],
    skipLabel: (page.skip || [, "Skip to converter"])[1],
    navLinks: renderNav(page.navLinks || defaultNav),
    jsonld: jsonld(page),
    eyebrow: page.eyebrow,
    h1: page.h1,
    lede: page.lede,
    dropTitle: page.dropTitle,
    ...(page.howtoTitle && { howtoTitle: page.howtoTitle, howtoIntro: page.howtoIntro, howtoAdd: page.howtoAdd }),
    faqTitle: page.faqTitle,
    faq: renderFaq(page.faq),
    related: renderRelated(page),
  };
  let html = template.replace(/{{(\w+)}}/g, (_, key) => {
    if (!(key in values)) throw new Error(`Missing value for {{${key}}} in ${page.file}`);
    return values[key];
  });
  html = html.replace(
    "<!doctype html>\n",
    `<!doctype html>\n<!-- Generated from templates/${page.template || "page.html"} by tools/build.mjs. Edit those, then run: node tools/build.mjs -->\n`
  );
  writeFileSync(join(root, page.file), html);
  console.log("wrote", page.file);
}

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages.map((p) => `  <url>\n    <loc>${urlOf(p)}</loc>\n    <lastmod>${today}</lastmod>\n  </url>`).join("\n")}
</urlset>
`;
writeFileSync(join(root, "sitemap.xml"), sitemap);
console.log("wrote sitemap.xml");
