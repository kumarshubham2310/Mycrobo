import { randomBytes, createHmac, scryptSync, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

function base64url(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input), "utf8");
  return buf.toString("base64url");
}

function fromBase64url(str) {
  return Buffer.from(str, "base64url").toString("utf8");
}

export class WebAuthManager {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.usersFile = join(dataDir, "users.json");
    this.secretFile = join(dataDir, "jwt-secret.key");
    this._init();
  }

  _init() {
    mkdirSync(this.dataDir, { recursive: true });
    if (!existsSync(this.secretFile)) {
      writeFileSync(this.secretFile, randomBytes(32).toString("hex"), "utf8");
    }
    this.jwtSecret = readFileSync(this.secretFile, "utf8").trim();
  }

  _readUsers() {
    try {
      if (existsSync(this.usersFile)) {
        const raw = readFileSync(this.usersFile, "utf8").trim();
        if (raw) return JSON.parse(raw);
      }
    } catch {}
    return [];
  }

  _writeUsers(users) {
    writeFileSync(this.usersFile, JSON.stringify(users, null, 2), "utf8");
  }

  hashPassword(password, salt = randomBytes(16).toString("hex")) {
    const digest = scryptSync(String(password), salt, 64).toString("hex");
    return { salt, digest };
  }

  verifyPassword(password, salt, expectedDigest) {
    try {
      const actual = scryptSync(String(password), salt, 64);
      const expected = Buffer.from(expectedDigest, "hex");
      return actual.length === expected.length && timingSafeEqual(actual, expected);
    } catch {
      return false;
    }
  }

  signJwt(payload) {
    const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
    const body = base64url(JSON.stringify(payload));
    const signature = createHmac("sha256", this.jwtSecret).update(`${header}.${body}`).digest("base64url");
    return `${header}.${body}.${signature}`;
  }

  verifyJwt(token) {
    if (!token || typeof token !== "string") return null;
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [headerB64, bodyB64, sigB64] = parts;
    const expectedSig = createHmac("sha256", this.jwtSecret).update(`${headerB64}.${bodyB64}`).digest("base64url");
    try {
      const a = Buffer.from(sigB64, "utf8");
      const b = Buffer.from(expectedSig, "utf8");
      if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
      const payload = JSON.parse(fromBase64url(bodyB64));
      if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
      return payload;
    } catch {
      return null;
    }
  }

  signup({ email, displayName, password, workspaceName }) {
    const normalizedEmail = String(email || "").trim().toLowerCase();
    if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalizedEmail)) {
      throw new Error("Enter a valid email address.");
    }
    const pwd = String(password || "");
    if (pwd.length < 8) {
      throw new Error("Password must be at least 8 characters.");
    }
    const name = String(displayName || normalizedEmail.split("@")[0] || "User").trim();

    const users = this._readUsers();
    if (users.some((u) => u.email === normalizedEmail)) {
      throw new Error("An account with this email already exists. Sign in instead.");
    }

    const userId = `user-${randomBytes(12).toString("hex")}`;
    const tenantId = `tenant-${randomBytes(8).toString("hex")}`;
    const { salt, digest } = this.hashPassword(pwd);
    const now = new Date().toISOString();
    const wsName = String(workspaceName || (name ? `${name}'s Workspace` : "My Workspace")).trim();

    const newUser = {
      id: userId,
      tenantId,
      email: normalizedEmail,
      displayName: name,
      workspaceName: wsName,
      salt,
      digest,
      createdAt: now,
    };
    users.push(newUser);
    this._writeUsers(users);

    return this.createSession(newUser);
  }

  login({ email, password }) {
    const normalizedEmail = String(email || "").trim().toLowerCase();
    const users = this._readUsers();
    const user = users.find((u) => u.email === normalizedEmail);
    if (!user || !this.verifyPassword(password, user.salt, user.digest)) {
      throw new Error("Invalid email or password.");
    }
    return this.createSession(user);
  }

  createSession(user) {
    const exp = Math.floor(Date.now() / 1000) + (30 * 86400); // 30-day session
    const payload = {
      sub: user.id,
      userId: user.id,
      tenantId: user.tenantId,
      email: user.email,
      displayName: user.displayName,
      workspaceName: user.workspaceName || `${user.displayName}'s Workspace`,
      role: "owner",
      exp,
    };
    const token = this.signJwt(payload);
    return {
      token,
      session: {
        id: `session-${randomBytes(12).toString("hex")}`,
        user: {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          platformAdmin: false,
          status: "active",
        },
        tenant: {
          id: user.tenantId,
          name: user.workspaceName || `${user.displayName}'s Workspace`,
          role: "owner",
          selected: true,
          status: "active",
        },
        expiresAt: new Date(exp * 1000).toISOString(),
      },
    };
  }

  userCount() {
    return this._readUsers().length;
  }
}
