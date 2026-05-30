import { parseCreateSignedTicketEvent } from "@pymthouse/builder-sdk/signer/server";
import { Kafka } from "kafkajs";
import { readClearinghouseConfig } from "./config.js";
import { getClearinghouseSql } from "./db.js";
import { ensureClearinghouseSchema } from "./schema.js";
import { recordCreateSignedTicketEvent } from "./accounting.js";

async function main(): Promise<void> {
  const config = readClearinghouseConfig();
  const sql = getClearinghouseSql(config.databaseUrl);
  await ensureClearinghouseSchema(sql);

  const kafka = new Kafka({ brokers: config.kafkaBrokers });
  const consumer = kafka.consumer({ groupId: config.kafkaGroupId });

  await consumer.connect();
  await consumer.subscribe({ topic: config.kafkaTopic, fromBeginning: false });

  console.info(`[clearinghouse] usage worker subscribed to ${config.kafkaTopic}`);

  await consumer.run({
    eachMessage: async ({ message }) => {
      if (!message.value) return;
      const raw = JSON.parse(message.value.toString("utf8")) as Record<string, unknown>;
      const event = parseCreateSignedTicketEvent(raw);
      await recordCreateSignedTicketEvent(sql, event);
    },
  });
}

main().catch((error) => {
  console.error("[clearinghouse] worker fatal", error);
  process.exit(1);
});
