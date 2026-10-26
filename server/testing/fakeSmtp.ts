import type { AddressInfo } from "node:net";
import { SMTPServer, type SMTPServerSession } from "smtp-server";

export type FakeBehavior = "accept" | "hang" | "drop" | { code: number; message: string };

export interface FakeSmtpOptions {
  user?: string;
  pass?: string;
}

export interface FakeSmtp {
  port: number;
  received: { from: string; to: string[]; raw: string }[];
  setRcptBehavior(fn: (to: string, n: number) => FakeBehavior): void;
  setDataBehavior(fn: (n: number) => FakeBehavior): void;
  setMailFromBehavior(fn: (from: string) => FakeBehavior): void;
  close(): Promise<void>;
}

type Callback = (err?: Error | null, message?: string) => void;

function smtpError(code: number, message: string): Error {
  return Object.assign(new Error(message), { responseCode: code });
}

export async function startFakeSmtp(opts: FakeSmtpOptions = {}): Promise<FakeSmtp> {
  const user = opts.user ?? "test";
  const pass = opts.pass ?? "test";
  const received: FakeSmtp["received"] = [];
  let rcptBehavior: (to: string, n: number) => FakeBehavior = () => "accept";
  let dataBehavior: (n: number) => FakeBehavior = () => "accept";
  let mailFromBehavior: (from: string) => FakeBehavior = () => "accept";
  let rcptCount = 0;
  let dataCount = 0;

  const server: SMTPServer = new SMTPServer({
    logger: false,
    authMethods: ["PLAIN", "LOGIN"],
    closeTimeout: 50,
    socketTimeout: 30_000,
    onAuth(auth, _session, callback) {
      if (auth.username === user && auth.password === pass) callback(null, { user: auth.username });
      else callback(smtpError(535, "5.7.8 Authentication credentials invalid"));
    },
    onMailFrom(address, session, callback) {
      apply(mailFromBehavior(address.address), session, callback);
    },
    onRcptTo(address, session, callback) {
      rcptCount += 1;
      apply(rcptBehavior(address.address, rcptCount), session, callback);
    },
    onData(stream, session, callback) {
      dataCount += 1;
      const behavior = dataBehavior(dataCount);
      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("end", () => {
        if (behavior === "accept") {
          received.push({
            from: session.envelope.mailFrom ? session.envelope.mailFrom.address : "",
            to: session.envelope.rcptTo.map((r) => r.address),
            raw: Buffer.concat(chunks).toString("utf8"),
          });
        }
        apply(behavior, session, (err) => callback(err, err ? undefined : `OK queued as fake-${dataCount}`));
      });
    },
  });

  function apply(behavior: FakeBehavior, session: SMTPServerSession, callback: Callback): void {
    if (behavior === "accept") return callback();
    if (behavior === "hang") return;
    if (behavior === "drop") {
      for (const conn of server.connections) if (conn.session === session || conn.id === session.id) conn._socket.destroy();
      return;
    }
    callback(smtpError(behavior.code, behavior.message));
  }

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  server.on("error", () => {});

  return {
    port: (server.server.address() as AddressInfo).port,
    received,
    setRcptBehavior: (fn) => {
      rcptBehavior = fn;
    },
    setDataBehavior: (fn) => {
      dataBehavior = fn;
    },
    setMailFromBehavior: (fn) => {
      mailFromBehavior = fn;
    },
    close: () =>
      new Promise<void>((resolve) => {
        for (const conn of server.connections) conn._socket.destroy();
        server.close(() => resolve());
      }),
  };
}
