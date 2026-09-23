// Builds the static landing pages from templates/page.html.
// No dependencies. Run after editing the template or the page content below:
//   node tools/build.mjs
// The generated .html files are committed and deployed as-is (Vercel needs no build step).

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = "https://3dconverter.bnap.dev";
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
];

/* ---------- Rendering ---------- */

const escapeAttr = (s) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const stripTags = (s) => s.replace(/<[^>]+>/g, "");
const urlOf = (p) => SITE + p.path;

const caret = '<svg class="icon" aria-hidden="true"><use href="/assets/icons-v1.svg#i-caret-down"/></svg>';
const renderFaq = (keys) =>
  keys
    .map((k) => `        <details>\n          <summary>${faq[k].q}${caret}</summary>\n          <p>${faq[k].a}</p>\n        </details>\n`)
    .join("");

const renderRelated = (current) =>
  '<span class="related-label">Converters</span>' +
  pages
    .map((p) => `<a href="${p.path}"${p === current ? ' aria-current="page"' : ""}>${p.nav}</a>`)
    .join(" ");

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
      featureList: [
        "Convert STEP (.step, .stp) to STL",
        "Convert IGES (.iges, .igs) to STL",
        "Bulk conversion with ZIP download",
        "Runs locally in the browser, no upload",
        "Draft, Standard and Fine mesh quality",
        "One STL per body for assemblies",
        "3D preview of the result",
      ],
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

const template = readFileSync(join(root, "templates/page.html"), "utf8");

for (const page of pages) {
  const values = {
    title: escapeAttr(page.title),
    description: escapeAttr(page.description),
    url: urlOf(page),
    ogTitle: escapeAttr(page.ogTitle),
    ogDescription: escapeAttr(page.ogDescription),
    ogImage: `${SITE}/${page.ogImage}`,
    ogImageAlt: escapeAttr(`3D Converter: bulk ${page.nav} converter, with a converted CAD assembly shown in 3D`),
    jsonld: jsonld(page),
    eyebrow: page.eyebrow,
    h1: page.h1,
    lede: page.lede,
    dropTitle: page.dropTitle,
    howtoTitle: page.howtoTitle,
    howtoIntro: page.howtoIntro,
    howtoAdd: page.howtoAdd,
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
    "<!doctype html>\n<!-- Generated from templates/page.html by tools/build.mjs. Edit those, then run: node tools/build.mjs -->\n"
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
