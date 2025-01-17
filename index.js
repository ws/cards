const crypto = require("crypto");
const path = require("path");
const emojiLib = require("node-emoji");
const forEachRow = require("notion-for-each-row");
const katex = require("katex");
const Prism = require("prismjs");
const loadLanguages = require("prismjs/components/");
const gitRev = require("git-rev-sync");
const nunjucks = require("nunjucks");
const indent = require("indent.js");
const fse = require("fs-extra");

const config = require("./lib/config")();
const {
  addDashes,
  concatenateText,
  notionDateStrToRelativeStr,
  downloadImageToPath,
} = require("./lib/utils");
const {
  emojiToFileName,
  emojiToBaseName,
  emojiToAltText,
} = require("./lib/emoji");
const { getTweetEmbedHTML } = require("./lib/twitter");
const { NOTION_DATE_STR_REGEX, TWITTER_URL_REGEX } = require("./lib/consts");

// build here
const outputDir = path.join(__dirname, config.outputDirectory);

// tell nunjucks to look for views in views/
nunjucks.configure("views");

let id = 1;
function getDeterministicUUID() {
  // grab the sha of the current commit
  const currentCommitSha = gitRev.long();

  const shasum = crypto.createHash("sha1");
  shasum.update(currentCommitSha);
  shasum.update("" + id++);
  return addDashes(shasum.digest("hex"));
}

// todo: doc + put elsewhere
const defaultPageFilename = (id) => `${id.replace(/-/g, "").slice(0, 8)}.html`;

// todo: doc + put elsewhere
const pageFilename = (id, properties) =>
  (properties.Filename ? concatenateText(properties.Filename.rich_text) : "") ||
  defaultPageFilename(id);

// todo: doc + put elsewhere
const imageFilename = (block) => `${block.id}.png`;

async function textToHtml(pageId, text, allPages) {
  if (text.type === "text") {
    const codeFriendly = text.text.content
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    const emojiToLoad = new Set([]);
    // v clever
    let content = emojiLib.replace(codeFriendly, ({ emoji }) => {
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

      if (NOTION_DATE_STR_REGEX.test(start)) {
        return notionDateStrToRelativeStr(start);
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

// grab the assets listed in config.copy.css, config.copy.images, config.copy.js to the build directory
async function copyStaticAssets(directory) {
  const { css, images, js } = config.copy;
  const assets = [...css, ...images, ...js].map((f) => path.join(__dirname, f));
  return Promise.all(
    assets.map(async (asset) =>
      fse.copy(asset, path.join(directory, path.basename(asset)))
    )
  );
}

const linkOfId = (allPages, id, args = {}) => {
  const page = allPages.find((entry) => entry.id === id);
  if (page) {
    return `<a href="/${page.filename}"${
      page.emoji ? ` class="with-emoji"` : ""
    }>
      ${
        page.emoji
          ? `<img class="emoji" alt="${page.emojiAltText || ""}" src="/${
              page.favicon
            }">`
          : ""
      }
      ${args.overwriteTitle || page.title}</a>`;
  } else {
    return `[${id}]`;
  }
};

// creates a file that just redirects to wherever it's told to redirect
// helpful for permalinks
const saveRedirect = async (from, to) => {
  const content = nunjucks.render("redirect.html", { to });
  await fse.writeFile(path.join(outputDir, from), content);
};

async function savePage(
  { id, title, favicon, content, filename, emoji, emojiAltText },
  backlinks,
  allPages
) {
  const footerBacklinks = Array.from(backlinks[id] || [])
    .sort()
    .map((id) => {
      const page = allPages.find((entry) => entry.id === id);
      return page;
    });

  const body = nunjucks.render("card.html", {
    id,
    title,
    favicon,
    emoji,
    emojiAltText,
    content,
    footerBacklinks,

    config,
  });

  // I don't *need* to do this, but it's a nice thing to do if anyone wants to look at HTML source
  const formattedBody = indent.html(body);

  await fse.writeFile(path.join(outputDir, filename), formattedBody);
  await saveRedirect(`${id}.html`, filename);

  // if you have a card and then later set a filename, instead of killing the link, this will forward it to the new filename
  if (filename != defaultPageFilename(id)) {
    await saveRedirect(defaultPageFilename(id), filename);
  }
}

function downloadImageBlock(block, blockId) {
  const filename = imageFilename(block);
  const destPath = path.join(outputDir, filename);

  const caption = concatenateText(block.image.caption);
  const html = `<figure id="${blockId}">
    <img alt="${caption}" src="/${filename}">
    <figcaption>${caption}</figcaption>
  </figure>`;

  if (fse.existsSync(destPath)) {
    return html;
  } else {
    // download the image
    downloadImageToPath(block.image.file.url, destPath);

    return html;
  }
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
    return `\n<div class="text" id="${blockId}">
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
    return `<hr id="${blockId}" />`;
  } else if (block.type === "unsupported") {
    return "[unsupported]";
  } else if (block.type === "callout") {
    const { icon } = block.callout;
    const text = concatenateText(block.callout.text);

    return `<div class="callout">${
      icon ? `<div style="padding: 24px;">${icon.emoji}</div>` : ""
    }<h2>${text}</h2></div>`;
  } else if (
    block.type === "embed" &&
    block.embed.url &&
    TWITTER_URL_REGEX.test(block.embed.url)
  ) {
    const tweetsPath =
      config.tweetEmbeds.cache && path.join(outputDir, "tweets.json");

    const tweetHtml = await getTweetEmbedHTML(block.embed.url, tweetsPath);

    const nonDirtyTweetHtml = tweetHtml.split("\n")[0]; // strip out twitter's JS injection

    // if you want stuff like RT count, like count, styling, etc. switch config.tweetEmbeds.includeExternalSrc to TRUE
    // just note that twitter is injecting gross analytics stuff on your site

    return !config.tweetEmbeds.includeExternalSrc
      ? nonDirtyTweetHtml
      : tweetHtml;
  } else if (block.type === "link_to_page") {
    registerBacklink(pageId, block.link_to_page.page_id);
    return linkOfId(allPages, block.link_to_page.page_id);
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
    backlinks[destinationId].add(sourceId);
  } else {
    backlinks[destinationId] = new Set([sourceId]);
  }
};

async function getAllChildBlocks(notion, id) {
  const blocks = [];

  let next_cursor = undefined;
  let has_more = true;

  while (has_more) {
    ({ results, has_more, next_cursor } = await notion.blocks.children.list({
      block_id: id,
      start_cursor: next_cursor,
    }));
    blocks.push(...results);
  }

  return blocks;
}

async function getChildren(notion, id) {
  const blocks = await getAllChildBlocks(notion, id);
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
  const basename = emojiToBaseName(emoji);
  const filename = emojiToFileName(emoji);

  if (!fse.existsSync(filename)) {
    console.log("Unknown emoji --", emoji);
  }
  const dest = path.join(outputDir, basename);
  await fse.copy(filename, dest, { overwrite: false }); // only copy if it doesn't already exist
  return basename;
}

const storePagesJson = (allPages) =>
  fse.writeJson(path.join(outputDir, "pages.json"), allPages);

const build = async (outputDirectory) => {
  // tell prism (syntax highlighter) to use the languages in config.prism.loadLanguages
  loadLanguages(config.prism.loadLanguages);

  const pages = [];

  // Make sure outputDirectory exists
  await fse.ensureDir(outputDirectory);

  const { secret: token, databaseId: database } = config.notion;

  // Load all the pages
  await forEachRow({ token, database }, async (page, notion) => {
    const { id, icon, properties } = page;
    const emoji = icon && icon.emoji;
    const emojiAltText = emoji ? emojiToAltText(emoji) : "";
    const title = concatenateText(properties.Name.title);
    const children = await getChildren(notion, id);
    const favicon = await saveFavicon(emoji || config.defaultFavicon);

    const filename = pageFilename(id, properties);

    const blocks = groupBy(
      groupBy(children, "numbered_list_item", "numbered_list"),
      "bulleted_list_item",
      "bulleted_list"
    );

    pages.push({
      id,
      favicon,
      emoji,
      emojiAltText,
      title,
      blocks,
      filename,
    });
  });

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
    copyStaticAssets(outputDirectory),
    storePagesJson(pages),
  ]);
};

build(outputDir);
