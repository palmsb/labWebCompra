import "dotenv/config";
import express from "express";
import cors from "cors";
import type { Request, Response, NextFunction } from "express";

import { pool, waitForDb } from "./db.js";
import { migrate } from "./migrate.js";
import { idempotency } from "./idempotency.js";
import { buscarSugestoes } from "./sugestoes.js";

const app = express();

/**
 * CORS totalmente liberado
 */
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "Idempotency-Key",
    ],
    exposedHeaders: ["Idempotent-Replay"],
  })
);

/**
 * Responde preflight OPTIONS
 */
app.options("*", cors());

app.use(express.json());

/**
 * Health check
 */
app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    servico: "compras",
  });
});

/**
 * GET /compras
 */
app.get("/compras", async (_req: Request, res: Response) => {
  try {
    const r = await pool.query(
      "SELECT * FROM compras ORDER BY criado_em DESC LIMIT 50"
    );

    res.json(r.rows);
  } catch (err) {
    console.error(err);

    res.status(500).json({
      erro: "erro ao buscar compras",
    });
  }
});

/**
 * POST /compras
 * protegido por idempotência
 */
app.post(
  "/compras",
  idempotency,
  async (req: Request, res: Response) => {
    try {
      const { produto, quantidade, valor_total } = req.body ?? {};

      if (
        typeof produto !== "string" ||
        !Number.isInteger(quantidade) ||
        quantidade <= 0 ||
        typeof valor_total !== "number"
      ) {
        res.status(400).json({
          erro: "payload inválido",
        });

        return;
      }

      /**
       * atraso artificial
       */
      await new Promise((r) => setTimeout(r, 3000));

      const r = await pool.query(
        `
        INSERT INTO compras (
          produto,
          quantidade,
          valor_total
        )
        VALUES ($1, $2, $3)
        RETURNING *
        `,
        [produto, quantidade, valor_total]
      );

      const compra = r.rows[0];

      /**
       * Sugestão best-effort
       */
      const sugestao = await buscarSugestoes(produto);

      res.status(201).json({
        compra,
        sugestao,
      });
    } catch (err) {
      console.error(err);

      res.status(500).json({
        erro: "erro ao criar compra",
      });
    }
  }
);

/**
 * Handler global de erros
 */
app.use(
  (
    err: any,
    _req: Request,
    res: Response,
    _next: NextFunction
  ) => {
    console.error("Erro global:", err);

    res.status(500).json({
      erro: "erro interno do servidor",
    });
  }
);

const PORT = Number(process.env.PORT ?? 4001);

/**
 * Inicialização
 */
waitForDb()
  .then(() => migrate())
  .then(() => {
    app.listen(PORT, () => {
      console.log(`[compras] ouvindo na porta ${PORT}`);
    });
  })
  .catch((e) => {
    console.error("Erro ao iniciar aplicação:", e);
    process.exit(1);
  });
