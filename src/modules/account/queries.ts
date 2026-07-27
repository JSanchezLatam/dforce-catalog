import { eq } from "drizzle-orm";

import { db } from "@/shared/db/client";
import { users } from "@/shared/db/schema";

export type UserProfile = {
  username: string;
  name: string | null;
  email: string | null;
  role: string;
};

export async function getUserProfile(
  userId: string,
  queryFn: () => Promise<UserProfile | null> = async () => {
    const row = await db
      .select({ username: users.username, name: users.name, email: users.email, role: users.role })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return row[0] ?? null;
  },
): Promise<UserProfile | null> {
  return queryFn();
}
