// turns c3d8522062aa457ab41490c5e9929790 into c3d85220-62aa-457a-b414-90c5e9929790
const addDashes = (id) =>
  [
    id.slice(0, 8),
    id.slice(8, 12),
    id.slice(12, 16),
    id.slice(16, 20),
    id.slice(20, 32),
  ].join("-");

// turn an array of Notion blocks into a string representation
const concatenateText = (arr) => arr.map((i) => i.text.content).join("");

// take a date str from notion and turn it into a JS date
const notionDateStrToJSDate = (str) => {
  const [year, month, day] = str.split("-").map((i) => parseInt(i));

  const date = new Date();
  date.setFullYear(year);
  date.setMonth(month - 1);
  date.setDate(day);

  return date;
};

// get relative date string given a JS date
const dateToRelativeStr = (date) => {
  const deltaDays = Math.round(
    (date.getTime() - Date.now()) / (1000 * 3600 * 24)
  );

  const relative = new Intl.RelativeTimeFormat("en", {
    numeric: "auto",
  });

  const formatted = relative.format(deltaDays, "days");
  return formatted[0].toUpperCase() + formatted.slice(1);
};

const notionDateStrToRelativeStr = (str) =>
  dateToRelativeStr(notionDateStrToJSDate(str));

module.exports = {
  addDashes,
  concatenateText,
  notionDateStrToJSDate,
  dateToRelativeStr,
  notionDateStrToRelativeStr,
};
