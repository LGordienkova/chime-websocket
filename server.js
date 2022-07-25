import fs from 'fs';
import AWS from 'aws-sdk';
import { randomUUID } from 'crypto';
import { WebSocketServer } from 'ws';

const port = 8080;
const currentRegion = 'us-east-1';
const wsUsers = {};

const chime = new AWS.Chime({ region: currentRegion });
chime.endpoint = new AWS.Endpoint('https://service.chime.aws.amazon.com');

const extMeetingId = randomUUID().substring(0, 4);
const requestId = randomUUID();

const createMeeting = async (message, ws) => {
  const fileData = await fs.promises.readFile('data/users.txt', 'utf8');
  const users = fileData
    .split('\n')
    .slice(0, -1)
    .map(user => ({ ExternalUserId: user }));

  const attendee = users.find(el => el.ExternalUserId === message.callingTo);

  if (!attendee) {
    ws.send(JSON.stringify({ statusCode: 404, message: `User ${message.callingTo} not found` }));
    return;
  }

  const meetingInfo = await chime
    .createMeetingWithAttendees({
      ClientRequestToken: requestId,
      Attendees: users,
      MediaRegion: currentRegion,
      ExternalMeetingId: extMeetingId,
    })
    .promise();

  meetingInfo['type'] = 'meetingInfoForIncomingCall';
  meetingInfo['callingFrom'] = message.userName;

  wsUsers[message.callingTo].send(JSON.stringify(meetingInfo));
};

const sendMeetingInfo = async message => {
  wsUsers[message.meetingInfo.callingFrom].send(
    JSON.stringify({ type: 'meetingInfoForOutgoingCall', meetingInfo: message.meetingInfo })
  );
};

const deleteMeeting = async (message, ws) => {
  try {
    const params = {
      MeetingId: message.MeetingId,
    };

    chime.deleteMeeting(params);

    wss.clients.forEach(client => client.send(JSON.stringify({ type: 'meetingEnded' })));

    await fs.promises.unlink('data/users.txt');
  } catch (error) {
    console.log(error);
  }
};

const onConnection = (data, ws) => {
  fs.appendFile('data/users.txt', data.userName + '\n', function (err) {
    if (err) return console.log(err);
  });

  ws.userName = data.userName;

  wsUsers[ws.userName] = ws;

  ws.send(JSON.stringify({ status: 'Successfully connected' }));
};

// Create WebSocket Server
const wss = new WebSocketServer({ port }, () => console.log(`Server started on ${port}`));

const onClose = async () => {
  try {
    await fs.promises.unlink('data/users.txt');
  } catch (e) {
    console.log(e);
  }
};

wss?.on('connection', function connection(ws) {
  ws.on('message', async function (message) {
    message = JSON.parse(message);

    switch (message.type) {
      case 'createMeeting':
        await createMeeting(message, ws);
        break;

      case 'deleteMeeting':
        await deleteMeeting(message, ws);
        break;

      case 'sendMeetingInfo':
        await sendMeetingInfo(message);
        break;

      case 'connect':
        onConnection(message, ws);
        break;

      case 'close':
        await onClose();

        break;
    }
  });
});
