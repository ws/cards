const crypto = require("crypto");
const fs = require("fs");
const https = require("https");
const path = require("path");
const emoji = require("node-emoji");
const emojiUnicode = require("emoji-unicode");
const forEachRow = require("notion-for-each-row");
const katex = require("katex");
const Prism = require("prismjs");
const loadLanguages = require("prismjs/components/");
const gitRev = require("git-rev-sync");
const nunjucks = require("nunjucks");

const fsPromises = fs.promises;

// if config.json exists, use that. otherwise use config.example.json. DOES do mergin. doesn't do validation. it's great.
let config = {}
if(fs.existsSync('config.example.json')) config = JSON.parse(fs.readFileSync('config.example.json'))
if(fs.existsSync('config.json')) config = { ...config, ...JSON.parse(fs.readFileSync('config.json')) }

// tell prism (syntax highlighter) to use the languages in config.prism.loadLanguages
loadLanguages(config.prism.loadLanguages);

let id = 1;
function getDeterministicUUID() {
  // grab the sha of the current commit
  const currentCommitSha = gitRev.long()

  const shasum = crypto.createHash("sha1");
  shasum.update(currentCommitSha);
  shasum.update("" + id++);
  return addDashes(shasum.digest("hex"));
}

// util function, turns c3d8522062aa457ab41490c5e9929790 into c3d85220-62aa-457a-b414-90c5e9929790
function addDashes(id) {
  return [
    id.slice(0, 8),
    id.slice(8, 12),
    id.slice(12, 16),
    id.slice(16, 20),
    id.slice(20, 32),
  ].join("-");
}

function concatenateText(arr) {
  return arr.map((i) => i.text.content).join("");
}

function relativeDate(str) {
  const [year, month, day] = str.split("-").map((i) => parseInt(i));

  const date = new Date();
  date.setFullYear(year);
  date.setMonth(month - 1);
  date.setDate(day);

  const deltaDays = Math.round(
    (date.getTime() - Date.now()) / (1000 * 3600 * 24)
  );

  const relative = new Intl.RelativeTimeFormat("en", {
    numeric: "auto",
  });

  const formatted = relative.format(deltaDays, "days");
  return formatted[0].toUpperCase() + formatted.slice(1);
}

async function textToHtml(pageId, text, allPages) {
  if (text.type === "text") {
    const codeFriendly = text.text.content
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    const emojiToLoad = new Set([]);
    let content = emoji.replace(codeFriendly, ({ emoji }) => {
      emojiToLoad.add(emoji);
      return emoji;
    });

    await Promise.all(
      [...emojiToLoad].map(async (emoji) => {
        const filename = await saveFavicon(emoji);
        // Hmmmm safe?
        content = content.replace(
          new RegExp(emoji, "ug"),
          `<img class="emoji" alt="${emoji}" src="${filename}" />`
        );
      })
    );

    if (text.annotations.bold) {
      content = `<strong>${content}</strong>`;
    }
    if (text.annotations.italic) {
      content = `<em>${content}</em>`;
    }
    if (text.annotations.underline) {
      content = `<u>${content}</u>`;
    }
    if (text.annotations.strikethrough) {
      content = `<strike>${content}</strike>`;
    }
    if (text.annotations.code) {
      content = `<code>${content}</code>`;
    }

    if (text.text.link) {
      // Links to other pages (not mentions), should also get back-linked
      if (/^\//.test(text.text.link.url)) {
        const id = text.text.link.url.slice(1);
        // Hack: format into "c3d85220-62aa-457a-b414-90c5e9929790"

        const backlinkFriendlyId = addDashes(id);

        registerBacklink(pageId, backlinkFriendlyId);
        return linkOfId(allPages, backlinkFriendlyId, {
          overwriteTitle: content,
        });
      } else {
        return `<a href="${text.text.link.url}">${content}</a>`;
      }
    } else {
      return content;
    }
  } else if (text.type === "mention") {
    if (text.mention.type === "page") {
      registerBacklink(pageId, text.mention.page.id);
      return linkOfId(allPages, text.mention.page.id);
    } else if (text.mention.type === "date") {
      const { start } = text.mention.date;

      if (/^\d{4}-\d{2}-\d{2}$/.test(start)) {
        return relativeDate(start);
      } else {
        const [date, time] = start.slice(0, 16).split("T");

        const options = { month: "short", day: "numeric", year: "numeric" };
        const longDate = new Intl.DateTimeFormat("en-US", options).format(
          new Date(date)
        );
        return `${longDate} – ${time}`;
      }
    } else {
      console.log("Unrecognized mention --", text);
    }
  } else if (text.type === "equation") {
    return katex.renderToString(text.equation.expression);
  } else {
    console.log("Unrecognized text --", text);
  }
}

// build here
const outputDir = path.join(__dirname, config.outputDirectory);

// grab the assets listed in config.copy.assets to the build directory
async function copyStaticAssets() {
  const assets = config.copy.assets.map(f => path.join(__dirname, f));
  return Promise.all(
    assets.map(async (asset) =>
      fsPromises.copyFile(asset, path.join(outputDir, path.basename(asset)))
    )
  );
}

const linkOfId = (allPages, id, args = {}) => {
  const page = allPages.find((entry) => entry.id === id);
  if (page) {
    return `<a href="/${page.filename}"${
      page.emoji ? ` class="with-emoji"` : ""
    }>
      ${page.emoji ? `<img class="emoji" alt="" src="/${page.favicon}">` : ""}
      ${args.overwriteTitle || page.title}</a>`;
  } else {
    return `[${id}]`;
  }
};

async function savePage(
  { id, title, favicon, content, filename, emoji },
  backlinks,
  allPages
) {

  const footerBacklinks = (backlinks[id] || []).sort().map(id => {
    const page = allPages.find((entry) => entry.id === id)
    return page
  })

  const script = await fsPromises.readFile(
    path.join(__dirname, "public/script.js")
  );

  const body = nunjucks.render('template.html', {
    title,
    favicon,
    emoji,
    content,
    footerBacklinks,
    script,

    mainClassName: `p${id.slice(0, 8)}`,
    config
  })
  
  await fsPromises.writeFile(path.join(outputDir, filename), body);
}

function downloadImageBlock(block, blockId) {
  const filename = `${block.id}.png`;
  const dest = fs.createWriteStream(
    path.join(__dirname, config.outputDirectory, `${block.id}.png`)
  );

  return new Promise((resolve) => {
    const caption = concatenateText(block.image.caption);
    const html = `<figure id="${blockId}">
      <img alt="${caption}" src="/${filename}">
      <figcaption>${caption}</figcaption>
    </figure>`;

    if (fs.existsSync(dest)) {
      resolve(html);
    } else {
      https.get(block.image.file.url, (res) => {
        res
          .pipe(dest)
          .on("finish", () => {
            resolve(html);
          })
          .on("error", () => {
            console.log("Image failed to write", block);
            resolve();
          });
      });
    }
  });
}

async function blockToHtml(block, pageId, allPages) {
  const textToHtml_ = async (texts) => {
    const converts = await Promise.all(
      texts.map((text) => textToHtml(pageId, text, allPages))
    );
    return converts.join("");
  };
  const blockId = "b" + block.id.replace(/-/g, "").slice(0, 8);
  const children = await Promise.all(
    block.children.map((block) => blockToHtml(block, pageId, allPages))
  );

  if (block.type === "bulleted_list") {
    return `<ul id="${blockId}">${children.join("\n")}</ul>`;
  } else if (block.type === "numbered_list") {
    return `<ol id="${blockId}">${children.join("\n")}</ol>`;
  } else if (block.type === "bulleted_list_item") {
    return `<li id="${blockId}">
      <div class="list-item">
        ${await textToHtml_(block.bulleted_list_item.text)}
      </div>
      ${children.join("\n")}
    </li>`;
  } else if (block.type === "numbered_list_item") {
    return `<li id="${blockId}">
      <div class="list-item">
        ${await textToHtml_(block.numbered_list_item.text)}
      </div>
      ${children.join("\n")}
    </li>`;
  } else if (block.type === "paragraph") {
    return `<div class="text" id="${blockId}">
      ${await textToHtml_(block.paragraph.text)}
      <div class="children">${children.join("\n")}</div>
    </div>`;
  } else if (block.type === "heading_1") {
    return `<h1 id="${blockId}">${await textToHtml_(
      block.heading_1.text
    )}</h1>`;
  } else if (block.type === "heading_2") {
    return `<h2 id="${blockId}">${await textToHtml_(
      block.heading_2.text
    )}</h2>`;
  } else if (block.type === "heading_3") {
    return `<h3 id="${blockId}">${await textToHtml_(
      block.heading_3.text
    )}</h3>`;
  } else if (block.type === "toggle") {
    return `<details id="${blockId}"><summary>${await textToHtml_(
      block.toggle.text
    )}</summary>${children.join("\n")}</details>`;
  } else if (block.type === "code") {
    const language = block.code.language.toLowerCase();
    if (language !== "plain text" && !Prism.languages[language]) {
      console.log("Unrecognized language --", language);
    }
    const code = Prism.languages[language]
      ? Prism.highlight(
          concatenateText(block.code.text),
          Prism.languages[language],
          language
        )
      : concatenateText(block.code.text);
    return `<pre id="${blockId}"><code class="language-${language.replace(
      /\s/g,
      "-"
    )}">${code}</code></pre>`;
  } else if (block.type === "equation") {
    return katex.renderToString(block.equation.expression, {
      displayMode: true,
    });
  } else if (block.type === "image") {
    if (block.image.type === "file") {
      return downloadImageBlock(block, blockId);
    } else if (block.image.type === "external") {
      const caption = concatenateText(block.image.caption);
      return `<figure id="${blockId}">
        <img alt="${caption}" src="${block.image.external.url}">
        <figcaption>${caption}</figcaption>
      </figure>`;
    } else {
      console.log("Unrecognized image", block);
    }
  } else if (block.type === "to_do") {
    return `<div><label>
      <input type="checkbox" onclick="return false" ${
        block.to_do.checked ? "checked" : ""
      }>
      ${await textToHtml_(block.to_do.text)}
    </label></div>`;
  } else if (block.type === "quote") {
    return `<blockquote>
      <p>${await textToHtml_(block.quote.text)}</p>
      ${children.join("\n")}
    </blockquote>`;
  } else if (block.type === "divider") {
    return "<hr />";
  } else if (block.type === "unsupported") {
    return "[unsupported]";
  } else {
    console.log("Unrecognized block --", block);
  }
}

function groupBy(blocks, type, result_type) {
  let result = [];
  let currentList = [];
  blocks.forEach((block) => {
    if (block.has_children) {
      block.children = groupBy(block.children, type, result_type);
    }

    if (block.type === type) {
      currentList.push(block);
    } else {
      if (currentList.length) {
        result.push({
          id: getDeterministicUUID(),
          has_children: true,
          type: result_type,
          children: currentList,
        });
        currentList = [];
      }

      result.push(block);
    }
  });

  if (currentList.length) {
    result.push({
      id: getDeterministicUUID(),
      has_children: true,
      type: result_type,
      children: currentList,
    });
  }

  return result;
}

const backlinks = {};
const registerBacklink = (sourceId, destinationId) => {
  if (backlinks[destinationId]) {
    backlinks[destinationId].push(sourceId);
  } else {
    backlinks[destinationId] = [sourceId];
  }
};

async function getChildren(notion, id) {
  // TODO: Paginate?
  const req = await notion.blocks.children.list({ block_id: id });
  const blocks = req.results;
  return Promise.all(
    blocks.map(async (block) => {
      if (block.has_children) {
        block.children = await getChildren(notion, block.id);
      } else {
        block.children = [];
      }
      return block;
    })
  );
}

async function saveFavicon(emoji) {
  const codepoints = emojiUnicode(emoji).split(" ").join("-");
  const basename = `${codepoints}.png`;
  const filename = path.join(
    __dirname,
    "node_modules/emoji-datasource-apple/img/apple/64",
    basename
  );
  if (!fs.existsSync(filename)) {
    console.log("Unknown emoji --", emoji, codepoints);
  }
  const dest = path.join(outputDir, basename);
  if (!fs.existsSync(dest)) {
    await fsPromises.copyFile(filename, dest);
  }
  return basename;
}

const storePagesJson = (allPages) => fsPromises.writeFile(path.join(outputDir, 'pages.json'), JSON.stringify(allPages))

(async () => {
  const pages = [];

  // Make sure outputDir exists
  if (!fs.existsSync(outputDir)) {
    await fsPromises.mkdir(outputDir);
  }

  // Load all the pages
  await forEachRow(
    {
      token: config.notion.secret,
      database: config.notion.databaseId,
    },
    async (page, notion) => {
      const { id, icon, properties } = page;

      const emoji = icon && icon.emoji;
      const title = concatenateText(properties.Name.title);
      const children = await getChildren(notion, id);
      const favicon = await saveFavicon(emoji || config.defaultFavicon);

      const filename =
        (properties.Filename
          ? concatenateText(properties.Filename.rich_text)
          : "") || `${id.replace(/-/g, "").slice(0, 8)}.html`;

      const blocks = groupBy(
        groupBy(children, "numbered_list_item", "numbered_list"),
        "bulleted_list_item",
        "bulleted_list"
      );

      pages.push({
        id,
        favicon,
        emoji,
        title,
        blocks,
        filename,
      });
    }
  );

  await Promise.all(
    pages.map(async (page) => {
      const renderedBlocks = await Promise.all(
        page.blocks.map(async (block) => blockToHtml(block, page.id, pages))
      );
      page.content = renderedBlocks.join("");
    })
  );

  Promise.all([
    ...pages.map((page) => savePage(page, backlinks, pages)),
    copyStaticAssets(),
    storePagesJson(pages)
  ]);
})();
