export interface User {
  name: string;
}

const users = new Map<string, User>([["1", { name: "Ada" }]]);

export function getUser(id: string): User {
  return users.get(id)!;
}

export function listUsers(): User[] {
  return [...users.values()];
}
