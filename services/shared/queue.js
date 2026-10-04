// services/shared/queue.js
// Message Queuing abstraction for SmartShelf (AWS SQS + Local File-Backed Queue Buffer)
// Provides reliable asynchronous buffering, cross-process IPC, spike-smoothing, and decoupling.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const logger = require("./logger");

const QUEUE_DIR = path.resolve(__dirname, ".queues");

function ensureQueueDir() {
  if (!fs.existsSync(QUEUE_DIR)) {
    try {
      fs.mkdirSync(QUEUE_DIR, { recursive: true });
    } catch (_) {}
  }
}

function getQueueFilePath(queueNameOrUrl) {
  ensureQueueDir();
  const name = queueNameOrUrl.split("/").pop() || queueNameOrUrl;
  const safeName = name.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(QUEUE_DIR, `${safeName}.json`);
}

function readQueueFile(queueNameOrUrl) {
  const filePath = getQueueFilePath(queueNameOrUrl);
  if (!fs.existsSync(filePath)) {
    return { name: queueNameOrUrl, messages: [], inFlight: [] };
  }
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch (_) {
    return { name: queueNameOrUrl, messages: [], inFlight: [] };
  }
}

function writeQueueFile(queueNameOrUrl, data) {
  const filePath = getQueueFilePath(queueNameOrUrl);
  const tmpPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(16).slice(2, 6)}`;
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf8");
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    try {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch (_) {}
  }
}

// ---------------------------------------------------------------------
// Send Message
// ---------------------------------------------------------------------
async function sendMessage(queueUrl, messageBody, attributes = {}) {
  const bodyString = typeof messageBody === "string" ? messageBody : JSON.stringify(messageBody);
  const messageId = `msg-${crypto.randomBytes(8).toString("hex")}`;
  const md5 = crypto.createHash("md5").update(bodyString).digest("hex");

  // Check if live AWS SQS is explicitly enabled
  if (process.env.USE_MOCK_SQS === "false" && process.env.AWS_ACCESS_KEY_ID) {
    try {
      const { SQSClient, SendMessageCommand } = require("@aws-sdk/client-sqs");
      const client = new SQSClient({ region: process.env.AWS_REGION || "us-east-1" });
      const response = await client.send(
        new SendMessageCommand({
          QueueUrl: queueUrl,
          MessageBody: bodyString,
        })
      );
      logger.info("Sent message to AWS SQS", { queueUrl, messageId: response.MessageId });
      return { MessageId: response.MessageId, MD5OfMessageBody: response.MD5OfMessageBody };
    } catch (err) {
      logger.error("Failed to send to AWS SQS, falling back to local queue", { error: err.message });
    }
  }

  // Local File-Backed Queue Buffer (shared across processes)
  const qData = readQueueFile(queueUrl);
  const msgObj = {
    MessageId: messageId,
    Body: bodyString,
    Attributes: {
      SentTimestamp: Date.now().toString(),
      ApproximateReceiveCount: 0,
    },
    MessageAttributes: attributes,
    MD5OfBody: md5,
    enqueuedAt: Date.now(),
  };

  qData.messages.push(msgObj);
  writeQueueFile(queueUrl, qData);

  logger.info("Enqueued message to local queue buffer", {
    queue: queueUrl,
    messageId,
    currentDepth: qData.messages.length,
  });

  return { MessageId: messageId, MD5OfMessageBody: md5 };
}

// ---------------------------------------------------------------------
// Receive Messages
// ---------------------------------------------------------------------
async function receiveMessages(queueUrl, maxMessages = 10, visibilityTimeoutSeconds = 30) {
  // Check if live AWS SQS is explicitly enabled
  if (process.env.USE_MOCK_SQS === "false" && process.env.AWS_ACCESS_KEY_ID) {
    try {
      const { SQSClient, ReceiveMessageCommand } = require("@aws-sdk/client-sqs");
      const client = new SQSClient({ region: process.env.AWS_REGION || "us-east-1" });
      const response = await client.send(
        new ReceiveMessageCommand({
          QueueUrl: queueUrl,
          MaxNumberOfMessages: maxMessages,
          VisibilityTimeout: visibilityTimeoutSeconds,
        })
      );
      return response.Messages || [];
    } catch (err) {
      logger.error("Failed to receive from AWS SQS, falling back to local queue", { error: err.message });
    }
  }

  // Local File-Backed Queue Buffer
  const qData = readQueueFile(queueUrl);
  const now = Date.now();

  // Return expired in-flight messages back to queue
  const remainingInFlight = [];
  for (const item of qData.inFlight || []) {
    if (item.expiresAt <= now) {
      item.message.Attributes.ApproximateReceiveCount = (item.message.Attributes.ApproximateReceiveCount || 0) + 1;
      qData.messages.unshift(item.message);
    } else {
      remainingInFlight.push(item);
    }
  }
  qData.inFlight = remainingInFlight;

  const batch = [];
  while (qData.messages.length > 0 && batch.length < maxMessages) {
    const msg = qData.messages.shift();
    const receiptHandle = `rcpt-${crypto.randomBytes(12).toString("hex")}`;
    const expiresAt = now + visibilityTimeoutSeconds * 1000;

    qData.inFlight.push({ receiptHandle, message: msg, expiresAt });

    batch.push({
      MessageId: msg.MessageId,
      ReceiptHandle: receiptHandle,
      Body: msg.Body,
      Attributes: msg.Attributes,
      MessageAttributes: msg.MessageAttributes,
    });
  }

  writeQueueFile(queueUrl, qData);
  return batch;
}

// ---------------------------------------------------------------------
// Delete Message (Acknowledge)
// ---------------------------------------------------------------------
async function deleteMessage(queueUrl, receiptHandle) {
  if (process.env.USE_MOCK_SQS === "false" && process.env.AWS_ACCESS_KEY_ID) {
    try {
      const { SQSClient, DeleteMessageCommand } = require("@aws-sdk/client-sqs");
      const client = new SQSClient({ region: process.env.AWS_REGION || "us-east-1" });
      await client.send(
        new DeleteMessageCommand({
          QueueUrl: queueUrl,
          ReceiptHandle: receiptHandle,
        })
      );
      return true;
    } catch (err) {
      logger.error("Failed to delete from AWS SQS", { error: err.message });
    }
  }

  const qData = readQueueFile(queueUrl);
  const initialLen = qData.inFlight.length;
  qData.inFlight = qData.inFlight.filter((f) => f.receiptHandle !== receiptHandle);
  writeQueueFile(queueUrl, qData);
  return qData.inFlight.length < initialLen;
}

// ---------------------------------------------------------------------
// Queue Statistics / Depth
// ---------------------------------------------------------------------
async function getQueueStats(queueUrl) {
  const qData = readQueueFile(queueUrl);
  const now = Date.now();

  let inFlightCount = 0;
  for (const flight of qData.inFlight || []) {
    if (flight.expiresAt > now) inFlightCount++;
  }

  return {
    queueName: queueUrl.split("/").pop() || queueUrl,
    approximateNumberOfMessages: qData.messages.length,
    approximateNumberOfMessagesNotVisible: inFlightCount,
  };
}

// ---------------------------------------------------------------------
// Continuous Polling Consumer Helper
// ---------------------------------------------------------------------
function startQueueConsumer({ queueUrl, handler, pollIntervalMs = 600, batchSize = 10 }) {
  let isRunning = true;

  const poll = async () => {
    if (!isRunning) return;
    try {
      const messages = await receiveMessages(queueUrl, batchSize);
      if (messages && messages.length > 0) {
        logger.info(`Received ${messages.length} message(s) from queue`, { queueUrl });
        for (const msg of messages) {
          try {
            let parsedBody = msg.Body;
            try {
              parsedBody = JSON.parse(msg.Body);
            } catch (_) {}

            await handler(parsedBody, msg);
            await deleteMessage(queueUrl, msg.ReceiptHandle);
          } catch (handlerErr) {
            logger.error("Error processing queue message", {
              messageId: msg.MessageId,
              error: handlerErr.message,
            });
          }
        }
      }
    } catch (pollErr) {
      logger.error("Queue poll error", { queueUrl, error: pollErr.message });
    } finally {
      if (isRunning) {
        setTimeout(poll, pollIntervalMs);
      }
    }
  };

  poll();

  return {
    stop: () => {
      isRunning = false;
      logger.info("Stopped queue consumer", { queueUrl });
    },
  };
}

module.exports = {
  sendMessage,
  receiveMessages,
  deleteMessage,
  getQueueStats,
  startQueueConsumer,
};
