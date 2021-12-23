const request = require('request-promise');

const OEMBED_BASE_URL = 'https://publish.twitter.com/oembed?url='

// twitter has a handy endpoint you can hit that gives you back the embed HTML for a given tweet URL
const fetchTweetEmbedHTML = async (tweetUrl) => {
    
    const response = await request({ uri: OEMBED_BASE_URL + tweetUrl, json: true })
    if(response && response.html) {
        return response.html
    }

    return `<a href="${tweetUrl}">Tweet</a>`
}

module.exports = {
    fetchTweetEmbedHTML
}