import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';

const ProfileSchema = z.object({
  name: z.string().min(1),
  apiBase: z.string().url(),
  teamId: z.string().min(1),
  bucket: z.string().min(1),
  region: z.string().min(1),
  cdnBase: z.string().url(),
  /** False until someone has confirmed cdnBase against a real V3 media URL; check-access prints it. */
  cdnBaseConfirmed: z.boolean().default(true),
  /** Where the hub is served; the hub lives at `${hubBase}/${slug}`. */
  hubBase: z.string().url().default('https://hub.member.dev'),
});

export type Profile = z.infer<typeof ProfileSchema>;

export function loadProfile(name: string, dir = 'profiles'): Profile {
  const path = resolve(join(dir, `${name}.json`));
  if (!existsSync(path)) {
    throw new Error(`no profile "${name}"; expected ${path}`);
  }
  const profile = ProfileSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
  if (profile.name !== name) {
    throw new Error(
      `profile file ${path} declares name "${profile.name}" but was loaded as "${name}"`,
    );
  }
  return profile;
}
