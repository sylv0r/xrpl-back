import { configDotenv } from "dotenv";
configDotenv();
import { Client, convertHexToString } from "xrpl";
import type { Request } from "xrpl";
import axios from "axios";
import algoliasearch from "algoliasearch";
import { z } from "zod";

const isHexadecimal = (str: string) => /^[0-9A-Fa-f]+$/g.test(str);

const HexadecimalString = z.string().refine((value) => isHexadecimal(value), {
  message: "Value must be a hexadecimal string",
});

const nftInfoResponse = z.object({
  price: z.string(),
  title: z.string().min(3).max(100),
  description: z.string().min(3).max(1000),
  image: z.string().url().max(1000).optional(),
});

const client = new Client(process.env.XRP_CLIENT_URL ?? "");
const algoliaClient = algoliasearch(
  process.env.ALGOLIA_APP_ID ?? "",
  process.env.ALGOLIA_APP_SECRET ?? "",
);

const algoliaClientIndex = algoliaClient.initIndex("beyond_beyond");

client.on("error", (errorCode, errorMessage) => {
  console.error(errorCode + ": " + errorMessage);
});

client.on("connected", () => {
  console.log("Connected to the XRPL");
});

client.on("disconnected", (code) => {
  console.log("Disconnected from the XRPL", code);
});

const getTokenDetails = (nftId: string) => {
  return { command: "nft_info", api_version: 2, nft_id: nftId } as Request;
};

const getTokenHistory = (nftId: string) => {
  return {
    command: "nft_history",
    api_version: 2,
    nft_id: nftId,
    limit: 1,
    ledger_index_max: -1,
    ledger_index_min: -1,
  } as Request;
};

const getPinataMetadata = async (url: string) => {
  return await axios.get(url);
};

// show all events
client.on("transaction", (transaction) => {
  if (
    !(
      transaction.transaction.TransactionType === "NFTokenCreateOffer" &&
      transaction.validated
    )
  ) {
    return;
  }
  client
    .request(getTokenDetails(transaction.transaction.NFTokenID))
    .then((res) => {
      // @ts-ignore
      if (!HexadecimalString.safeParse(res.result.uri).success) {
        console.log("Invalid URI");
        return;
      }
      // @ts-ignore
      const url = convertHexToString(res.result.uri);

      if (!z.string().url().safeParse(url).success) {
        console.log("Invalid URL");
        return;
      }

      getPinataMetadata(url).then((res) => {
        const metadata = res.data;
        if (!nftInfoResponse.safeParse(metadata).success) {
          console.log(nftInfoResponse.safeParse(metadata));
          console.log(metadata);
          console.log("Invalid metadata");
          return;
        }
        client
          // @ts-ignore
          .request(getTokenHistory(transaction.transaction.NFTokenID))
          .then((res) => {
            if (
              // @ts-ignore
              metadata.price !==
              // @ts-ignore
              res.result.transactions[0].tx_json.Amount
            ) {
              console.log(
                "Price mismatch",
                // @ts-ignore
                res.result.transactions[0].tx_json,
                metadata.price,
              );
              return;
            }
            // add to algolia
            algoliaClientIndex
              .saveObject({
                // @ts-ignore
                objectID: transaction.transaction.NFTokenID,
                ...metadata,
              })
              .then(({ objectID }) => {
                console.log("New nft added to algolia", objectID);
              })
              .catch((err) => {
                console.error(err);
              });
          });
      });
    });
});

const subscribeMessage = {
  command: "subscribe",
  streams: ["transactions"],
} as Request;

const start = async () => {
  await client.connect();
  await client.request(subscribeMessage);
};

start();
