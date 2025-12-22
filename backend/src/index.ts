import express from "express";
import cors from "cors";
import routes from "./routes.js";

const app = express();
app.use(cors());
app.use(express.json());

app.use("/api", routes);

const PORT = process.env.PORT ?? 3001;
app.listen(PORT, () => {
  console.log(`Backend running on ${PORT}`);
});
