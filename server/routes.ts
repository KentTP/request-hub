import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { insertRequestSchema } from "@shared/schema";
import { z } from "zod";

export async function registerRoutes(httpServer: Server, app: Express) {
  // Get all requests
  app.get("/api/requests", (_req, res) => {
    try {
      const items = storage.getAllRequests();
      res.json(items);
    } catch (e) {
      res.status(500).json({ error: "Failed to fetch requests" });
    }
  });

  // Create request
  app.post("/api/requests", (req, res) => {
    try {
      const data = insertRequestSchema.parse(req.body);
      const item = storage.createRequest(data);
      res.status(201).json(item);
    } catch (e) {
      if (e instanceof z.ZodError) {
        res.status(400).json({ error: e.errors });
      } else {
        res.status(500).json({ error: "Failed to create request" });
      }
    }
  });

  // Update request
  app.patch("/api/requests/:id", (req, res) => {
    try {
      const { id } = req.params;
      const data = insertRequestSchema.partial().parse(req.body);
      
      // Handle status → done: set completedAt
      const extra: any = {};
      if (data.status === "done") {
        extra.completedAt = new Date();
      } else if (data.status && data.status !== "done") {
        extra.completedAt = null;
      }

      const item = storage.updateRequest(id, { ...data, ...extra });
      if (!item) return res.status(404).json({ error: "Not found" });
      res.json(item);
    } catch (e) {
      res.status(500).json({ error: "Failed to update request" });
    }
  });

  // Delete request
  app.delete("/api/requests/:id", (req, res) => {
    try {
      const { id } = req.params;
      const ok = storage.deleteRequest(id);
      if (!ok) return res.status(404).json({ error: "Not found" });
      res.status(204).send();
    } catch (e) {
      res.status(500).json({ error: "Failed to delete request" });
    }
  });

}
