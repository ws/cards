const request = require("request-promise");
const fse = require("fs-extra");

const { TWITTER_URL_REGEX } = require("./consts");

const OEMBED_BASE_URL = "https://publish.twitter.com/oembed?url=";

// twitter has a handy endpoint you can hit that gives you back the embed HTML for a given tweet URL
const fetchTweetEmbedHTML = async (tweetUrl) => {
  const response = await request({
    uri: OEMBED_BASE_URL + tweetUrl,
    json: true,
  });
  if (response && response.html) {
    return response.html;
  }

  return `<a href="${tweetUrl}">Tweet</a>`;
};

// if we have it in the cache, return it from cache. otherwise grab it, cache it, and return it. like the daft punk song.
const getTweetEmbedHTML = async (tweetUrl, tweetsPath) => {
  // pull the tweet ID out of the URL
  const tweetId = tweetUrl.match(TWITTER_URL_REGEX)[3];

  // if a tweetsPath is passed, use it as cache source
  let cachedTweets = {};
  if (tweetsPath) {
    try {
      cachedTweets = await fse.readJson(tweetsPath, { throws: false });
      if (cachedTweets[`${tweetId}`]) return cachedTweets[`${tweetId}`];
    } catch (e) {}
  }

  const tweet = await fetchTweetEmbedHTML(tweetUrl);

  // if a tweetsPath is passed, cache this newfound tweet to it
  if (tweetsPath) {
    cachedTweets[`${tweetId}`] = tweet;
    await fse.writeJson(tweetsPath, cachedTweets);
  }

  return tweet;
};

module.exports = {
  fetchTweetEmbedHTML,
  getTweetEmbedHTML,
};
