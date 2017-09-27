'use strict';

const bodyParser = require('body-parser'),
      express = require('express'),
      fetch = require('node-fetch'),
      request = require('request'),
      { Wit, log } = require('node-wit');

const PORT = process.env.PORT || 8445;

const WIT_TOKEN = process.env.WIT_TOKEN;
const FB_PAGE_ACCESS_TOKEN = process.env.FB_PAGE_ACCESS_TOKEN;
const FB_VERIFY_TOKEN = process.env.FB_VERIFY_TOKEN;

if (!FB_PAGE_ACCESS_TOKEN) { throw new Error('missing FB_PAGE_ACCESS_TOKEN') }

// ----------------------------------------------------------------------------
// Messenger API specific code

// See the Send API reference
// https://developers.facebook.com/docs/messenger-platform/send-api-reference

const fbMessage = (id, text) => {
  const body = JSON.stringify({
    recipient: { id },
    message: { text },
  });

  const url = `https://graph.facebook.com/v2.6/me/messages?access_token=${encodeURIComponent(FB_PAGE_ACCESS_TOKEN)}`;

  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  })
  .then(res => res.json())
  .then(json => {
    if (json.error && json.error.message) {
      throw new Error(json.error.message);
    }
    return json;
  });
};

// ----------------------------------------------------------------------------
// Wit.ai bot specific code

// This will contain all user sessions.
// Each session has an entry:
// sessionId -> {fbid: facebookUserId, context: sessionState}
const sessions = {};

const findOrCreateSession = fbid => {
  let sessionId;

  Object.keys(sessions).forEach(id => {
    if (sessions[id].fbid === fbid)
      sessionId = id;
  });

  if (!sessionId) {
    // No session found for user fbid, let's create a new one
    sessionId = new Date().toISOString();
    sessions[sessionId] = {
      fbid: fbid,
      context: {}
    };
  }

  return sessionId;
};

// Setting up our bot
const wit = new Wit({
  accessToken: WIT_TOKEN,
  logger: new log.Logger(log.INFO)
});

const queryWit = (text, n = 1) => {
  return fetch(
    `https://api.wit.ai/message?v=20170307&n=${n}&q=${encodeURIComponent(text)}`,
    {
      headers: {
        Authorization: `Bearer ${WIT_TOKEN}`,
        'Content-Type': 'application/json',
      }
    }
  ).then(res => res.json());
};

// maps wit intents to responses
const responses = {
  get_location_in_airport: 'You can find our buses at the Airport parking lot, behind the Costa del Sol Hotel (Next to International fights arrival)',
  get_schedule: 'You can find our timetables at this link: https://www.airportexpresslima.com/timetables/ \n Please be aware, for International flights it is recommended to be at the airport 3 hours before the flight and 2 hours before for domestic flights.',
  get_info: 'You can find how our service works in this link: https://www.airportexpresslima.com/how-it-works/',
  get_payment_info: 'You can pay our guides in cash on board the bus. Also you can buy your tickets at our airport counter or online at this link:  https://www.airportexpresslima.com/tickets/',
  get_stops_info: 'We have 7 official stops in Miraflores. You can find more detailed information about our stops in this link: https://www.airportexpresslima.com/find-your-stop/',
  get_prices: 'You can find our prices at this link: https://www.airportexpresslima.com/tickets/',
  get_validity: 'Your ticket is valid for 6 months. You can use it on any bus, any day during those 6 months',
  get_roundtrip_info: 'Our system only allows to select the departure date/time, as usually the passengers do not show up the day they indicate for their return, for that reason, the ticket is open for any return day/time. For your return, you only need to show the voucher that will be given on board on the day of your departure. Your ticket is valid for 6 months.'
};

const handleMessage = message => {
  console.log(message);
  return queryWit(message).then(({entities}) => {
    console.log(entities);
    const intent = firstEntity(entities, 'intent');
    if (!intent) {
      console.log('🤖  Try something else. I got no intent :)');
      return;
    }

    if (intent.value in responses) {
      return responses[intent.value];
    }
    return console.log(`🤖  ${intent.value}`);
  });
}

const firstEntity = (entities, name)  => {
  return entities &&
    entities[name] &&
    Array.isArray(entities[name]) &&
    entities[name] &&
    entities[name][0];
}

const app = express();
app.use(bodyParser.json());

// Webhook setup
app.get('/webhook', (req, res) => {
  if (req.query['hub.mode'] === 'subscribe' &&
    req.query['hub.verify_token'] === FB_VERIFY_TOKEN) {
    res.send(req.query['hub.challenge']);
  } else {
    res.sendStatus(400);
  }
});

// Message handler
app.post('/webhook', (req, res) => {
  // Parse the Messenger payload
  // See the Webhook reference
  // https://developers.facebook.com/docs/messenger-platform/webhook-reference
  const data = req.body;

  if (data.object !== 'page') {
    return;
  }

  data.entry.forEach(entry => {
    entry.messaging.forEach(event => {
      if (event.message && !event.message.is_echo) {
        const sender = event.sender.id;

        // We retrieve the user's current session, or create one if it doesn't exist
        // This is needed for our bot to figure out the conversation history
        const sessionId = findOrCreateSession(sender);

        // We retrieve the message content
        const {text, attachments} = event.message;

        if (attachments) {
          fbMessage(sender, 'Sorry I can only process text messages for now.')
          .catch(console.error);
        } else if (text) {
          handleMessage(text)
          .then(response => fbMessage(sender, response))
          .catch(console.err)
        }
      } else {
        console.log('received event', JSON.stringify(event));
      }
    });
  });

  res.sendStatus(200);
});

app.listen(PORT);

console.log('Listening on :' + PORT + '...');
