This is my fork of cards. Jordan's is better. Go buy some [jordancoin](https://twitter.com/jdan/status/1473739164613029894).

Some notable changes:
  - config.json file
  - use nunjucks for HTML templating
  - use the git-rev-sync dependency instead of calling childprocess
  - creates a pages.json file in the build directory with source content artifacts (just in case Notion disappears)
  - emoji alt text

## cards

Turn a [Notion](https://notion.so) database into a deck of cards. I use this to power [cards.jordanscales.com](https://cards.jordanscales.com).

<img width="1381" alt="a desktop with notion open on the left and a rendered notion page using this library on the right" src="https://user-images.githubusercontent.com/287268/144431224-ac4673ba-e432-47d7-94c5-c82ecbadb986.png">

### usage

As a heads up, this barely works at all. It works even less with Will's changes.

- [Create a new Notion integration](https://developers.notion.com/docs/getting-started#step-1-create-an-integration)
- Create a new database and note it's ID from the address bar
  - `https://www.notion.so/[username]/[your database ID, copy this!]?v=[ignore this]`
- [Share that database with your new integration](https://developers.notion.com/docs/getting-started#step-2-share-a-database-with-your-integration)
- Run the script

```sh
git clone https://github.com/jdan/cards.git
npm i
mv config.example.json config.json
# edit config.json with your notion secret + DB id
npx serve build   # build/ contains everything you need
# localhost:5000 now shows your cards
```

### random notes
#### how to make a homepage

1) create a Notion property called "Filename"
2) set that property to index.html