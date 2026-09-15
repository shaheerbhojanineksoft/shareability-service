import type { Collection, Document, Filter } from "mongodb";
import { randomUUID } from "node:crypto";

import { getDb } from "./mongo";
import { constants } from "../config/constants";

async function socialConnections(): Promise<Collection<Document>> {
  return (await getDb()).collection(constants.SOCIAL_CONNECTIONS_COLLECTION);
}

/**
 * findByQuery — mirrors the webapi mongo wrapper:
 *   collection.find(query).toArray()  (index [0] is used by the caller).
 */
export async function findByQuery(
  query: Filter<Document>
): Promise<Document[]> {
  return (await socialConnections()).find(query).toArray();
}

/**
 * update — mirrors the webapi mongo wrapper:
 *   delete doc._id; doc.modifiedOn = Date.now();
 *   updateOne({ _id: id }, { $set: doc }, { upsert: true });
 *   doc._id = id; return doc
 */
export async function updateConnection(
  id: string,
  doc: Document
): Promise<Document> {
  delete doc._id;
  doc.modifiedOn = Date.now();

  // _id is a plain string (uuid v4).
  await (
    await socialConnections()
  ).updateOne({ _id: id } as any, { $set: doc }, { upsert: true });

  doc._id = id;
  return doc;
}

/**
 * insert — mirrors the webapi mongo wrapper:
 *   doc._id = uuidv4(); doc.createdOn = Date.now(); doc.isDeleted = false;
 *   insertOne(doc); return doc
 */
export async function insertConnection(doc: Document): Promise<Document> {
  doc._id = randomUUID();
  doc.createdOn = Date.now();
  doc.isDeleted = false;

  await (await socialConnections()).insertOne(doc);
  return doc;
}
