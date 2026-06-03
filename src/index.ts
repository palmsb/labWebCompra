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
 * CORS LIBERADO
 */
app.use(cors());

/**
 * JSON
 */
app.use(express.json());

/**
 * HEALTH
 */
app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    servico: "compras",
  });
});

/**
 * LISTAR COMPRAS
 */
app.get("/compras", async (_req: Request, res: Response) => {
  try {
    const r = await pool.query(
      "SELECT * FROM compras ORDER BY criado_em DESC LIMIT 50"
    );

    res.json(r.rows);
  } catch (err) {
    console.error("ERRO GET /compras:", err);

    res.status(500).json({
      erro: "erro interno",
    });
  }
});

/**
 * CRIAR COMPRA
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

      const sugestao = await buscarSugestoes(produto);

      res.status(201).json({
        compra,
        sugestao,
      });
    } catch (err) {
      console.error("ERRO POST /compras:", err);

      res.status(500).json({
        erro: "erro interno",
      });
    }
  }
);

/**
 * ERRO GLOBAL
 */
app.use(
  (
    err: any,
    _req: Request,
    res: Response,
    _next: NextFunction
  ) => {
    console.error("ERRO GLOBAL:", err);

    res.status(500).json({
      erro: "erro interno servidor",
    });
  }
);

const PORT = Number(process.env.PORT ?? 4001);

/**
 * START
 */
waitForDb()
  .then(async () => {
    console.log("Banco conectado");

    await migrate();

    app.listen(PORT, () => {
      console.log(`[compras] ouvindo na porta ${PORT}`);
    });
  })
  .catch((e) => {
    console.error("ERRO AO INICIAR:", e);

    process.exit(1);
  });
