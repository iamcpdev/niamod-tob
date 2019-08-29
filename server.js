// server.js
const express = require('express');
const app = express();
const bodyParser = require('body-parser');
const Airtable = require('airtable');
const request = require('request');

const SLACK_VERIFICATION_TOKEN = process.env.SLACK_VERIFICATION_TOKEN;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const AIRTABLE_TABLE_ID = process.env.AIRTABLE_TABLE_ID;

const base = Airtable.base(AIRTABLE_BASE_ID);

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({
  extended: true,
}));

// Routing stuff
app.get("/", function (req, res) {
  res.send('success');
});

const primaryFieldName = 'First Name';
const secondaryFieldName = 'Last Name';
const fieldNamesToSearch = [
// Search fields
  primaryFieldName,
  secondaryFieldName,
];

// Helper function to escape some special characters for Slack.
function slackEscape(str) {
  return str.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;');
};

// Takes an Airtable record and formats it as a Slack attachment.
function formatAirtableRecordAsSlackAttachment(record) {
  // Get the primary field name, which we'll use as the title for the Slack attachment.
  const primaryFieldValue = record.get(primaryFieldName) || 'Untitled record';
  const title = slackEscape(primaryFieldValue);

  // Construction of Slack attachment.
  const attachment = {
    title,
    fallback: title,
    title_link: `https://airtable.com/${AIRTABLE_TABLE_ID}/${record.getId()}`,
  };

  // So that our Slack attachments don't get too long, we're capping the number of included fields at 6.
  // This limit is totally arbitrary though, so update it as you see fit :)
  const maxFieldsToShow = 6;

  // Let's go through this record's fields and format them for Slack.
  const fieldNames = Object.keys(record.fields);
  const slackAttachmentFields = [];
  for (const fieldName of fieldNames) {
    if (slackAttachmentFields.length >= maxFieldsToShow) {
      // Reached the # of fields limit, so just break out of the loop.
      break;
    }

    if (fieldName === primaryFieldName) {
      // Skip the primary field, since we already used it as the attachment title.
      continue;
    }

    const fieldValue = record.get(fieldName);
    if (!fieldValue) {
      // Skip empty values.
      continue;
    }

    // Slack's short flag dictates how much horizontal space this attachment field should use.
    const short = fieldValue.length < 25;

    // Push this onto our array so that it's included in the Slack attachment.
    slackAttachmentFields.push({
      title: fieldName,
      value: slackEscape(fieldValue),
      short: short,
    });
  }

  // Set the fields on the attachment so that it uses the fields we just accumulated.
  attachment.fields = slackAttachmentFields;
  return attachment;
};

function isAuthorized(name, userID) {

}

app.post("/slack", function (req, res) {
  // console.log(req.body)
  // Verify that this request is actually coming from Slack before continuing.
  const token = req.body.token;
  if (token !== process.env.SLACK_VERIFICATION_TOKEN) {
    res.status(403).send('Forbidden');
  }
  
  // Pull the search query out from the request.
  const searchQuery = req.body.text;
  
  // Immediately respond to the request, telling the user that we're searching for records.
  // By responding immediately, we can ensure that we won't hit Slack's 3 second timeout.
  res.status(201).json({
    response_type: 'ephemeral',
    text: `Searching for records matching "${searchQuery}"`,
  });
  
  // Slack gives us a response URL that we can use to post back to the channel after our
  // initial response, so let's pull that out.
  const responseUrl = req.body.response_url;
  
  // Convert the search query to lowercase so we find records regardless of casing.
  const lowerCaseSearchQuery = searchQuery.toLowerCase();
  
  // Construct search statements for each field we're searching.
  const searchStatements = [];
  for (const fieldName of fieldNamesToSearch) {
    searchStatements.push(`SEARCH('${lowerCaseSearchQuery}', LOWER({${fieldName}})) > 0`);
  }
  
  // Join the search statements together using an OR formula.
  const formula = `OR(${searchStatements.join(', ')})`;
  
  // Query Airtable for records that match the filterByFormula that we constructed.
  base(AIRTABLE_TABLE_ID).select({
    filterByFormula: formula,
    
    // Specify the 'string' cellFormat so that all values are human-readable.
    cellFormat: 'string',
    
    // When using the 'string' cellFormat, we have to pass userLocale and timeZone
    // as well, so that dates are formatted properly.
    userLocale: 'en-US',
    timeZone: 'America/New_York',
  }).all().then(records => {
    // Successfully retrieved records, so let's format them for Slack and return.
    const maxNumRecordsToReturn = 10;
    const attachments = records.map(record => formatAirtableRecordAsSlackAttachment(record)).slice(0, maxNumRecordsToReturn);
    let text = `Found ${records.length} records matching "${searchQuery}"`;
    if (records.length > maxNumRecordsToReturn) {
      text += ` (showing first ${maxNumRecordsToReturn})`;
    }
    
    base(AIRTABLE_TABLE_ID).select({
      view: 'Grid view'
    }).firstPage((err, records) => {
      records.forEach(record => {
        if ((req.body.user_id === record.get('User ID') && req.body.text === record.get('First Name')) || (req.body.user_id === 'UBPHTH6DP')) {
          request({
            method: 'POST',
            uri: responseUrl,
            body: {
              // Make the response type "in_channel" so it is visible to everyone. If you want the response to be visible only to the
              // user who issued the command, change this to "ephemeral".
              response_type: 'ephemeral',
              text: text,
              attachments: attachments,
            },
            json: true,
          })
        }
      })
    })
  }).catch(err => {
    console.log(err.message)
    // Received an error, so let's respond with a message telling the user that the request failed.
    request({
      method: 'POST',
      uri: responseUrl,
      body: {
        // Make the response type "ephemeral" so it is not visible to the entire channel (just to the user who issued the command).
        response_type: 'ephemeral',
        text: 'Failed to fetch records from Airtable',
      },
      json: true,
    });
  });
});

// listen for requests :)
const listener = app.listen(process.env.PORT, function () {
  console.log('Gatekeeping has started apparently ' + listener.address().port);
});
