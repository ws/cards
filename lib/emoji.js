const emojiUnicode = require("emoji-unicode");
const emojiLib = require("node-emoji");
const path = require("path");

const EMOJI_DIRECTORY = "node_modules/emoji-datasource-apple/img/apple/64";

// 👟 -> 1f45f.png, 💡 -> 1f4a1.png, etc.
const emojiToBaseName = (emojiStr) =>
  emojiUnicode(emojiStr).split(" ").join("-") + ".png";

// basically the same as above, but includes full file path
// terrible function name
const emojiToFileName = (emojiStr) => {
  const basename = emojiToBaseName(emojiStr);
  const filename = path.join(__dirname, "../", EMOJI_DIRECTORY, basename);
  return filename;
};

// 👟 -> "athletic shoe emoji", 💡 -> "lightbulb emoji"
const emojiToAltText = (emojiStr) =>
  emojiLib.which(emojiStr).replace(/_/g, " ") + " emoji" || "";

module.exports = {
  emojiToBaseName,
  emojiToFileName,
  emojiToAltText,
};
