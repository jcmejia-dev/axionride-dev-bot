import "dotenv/config";
import { z } from "zod";

const idList = z.string().default("").transform((value) =>
  new Set(value.split(",").map((id) => id.trim()).filter(Boolean)),
);
const publicUrl = z.string().url().refine((url) => url.startsWith("https://"), "must use HTTPS");

const schema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: z.string().min(1),
  DISCORD_GUILD_ID: z.string().optional(),
  ALLOWED_DISCORD_USER_IDS: idList,
  ALLOWED_DISCORD_ROLE_IDS: idList,
  GITHUB_TOKEN: z.string().min(1),
  GITHUB_OWNER: z.string().regex(/^[A-Za-z0-9_.-]+$/),
  GITHUB_REPO: z.string().regex(/^[A-Za-z0-9_.-]+$/),
  GITHUB_WORKFLOW_FILE: z.string().regex(/^[A-Za-z0-9_.-]+\.ya?ml$/),
  GITHUB_BRANCH: z.string().regex(/^[A-Za-z0-9._/-]+$/),
  DISCORD_ANNOUNCEMENTS_CHANNEL_ID: z.string().optional(),
  DISCORD_BUILD_STATUS_CHANNEL_ID: z.string().min(1),
  DISCORD_CHANGELOG_CHANNEL_ID: z.string().optional(),
  GITHUB_REPOSITORY_URL: publicUrl,
  GITHUB_ACTIONS_URL: publicUrl,
  EAS_PROJECT_URL: publicUrl,
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
}).superRefine((config, context) => {
  if (config.ALLOWED_DISCORD_USER_IDS.size === 0 && config.ALLOWED_DISCORD_ROLE_IDS.size === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "at least one allowed Discord user or role ID is required" });
  }
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = schema.safeParse(env);
  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((issue) => issue.path[0] ?? "authorization"))];
    throw new Error(`Invalid configuration fields: ${fields.join(", ")}`);
  }
  return result.data;
}

