const fs = require("fs");
const { DEFAULT_NOTION_SECRET, DEFAULT_NOTION_DB_ID } = require("./consts");

const CONFIG_JSON = "config.json";
const CONFIG_EXAMPLE = "config.example.json";

// if config.json exists, use that. otherwise use config.example.json. DOES do merging. does very basic validation. it's great.

module.exports = () => {
  let config = {};
  if (fs.existsSync(CONFIG_EXAMPLE))
    config = JSON.parse(fs.readFileSync(CONFIG_EXAMPLE));
  if (fs.existsSync(CONFIG_JSON))
    config = { ...config, ...JSON.parse(fs.readFileSync(CONFIG_JSON)) };

  if (!config.notion) throw new Error("No Notion config found in config.json");
  const { notion } = config;

  // TODO: more validation that the shape of the Notion secret string looks right
  if (!notion.secret || notion.secret === DEFAULT_NOTION_SECRET) {
    throw new Error(
      "Invalid Notion secret, make sure you set one in config.json"
    );
  }

  // TODO: more validation that the shape of the Notion DB string looks right
  if (!notion.databaseId || notion.databaseId === DEFAULT_NOTION_DB_ID) {
    throw new Error(
      "Invalid Notion database ID, make sure you set one in config.json"
    );
  }

  return config;
};
