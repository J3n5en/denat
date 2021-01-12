const encoder = new TextEncoder();
const decoder = new TextDecoder();
import { exists } from "https://deno.land/std/fs/mod.ts";
import { getFreePort } from "https://deno.land/x/free_port@v1.2.0/mod.ts";
import serve from "./fileServe.ts";

const CONFIG_SAMPLE = `
// 可选type为 tcp, http, directory;
// 可选domain为：
// 腾讯云广州(1M) => test.utools.club;
// 腾讯云上海(10M) => cn.utools.club;
// 茶猫云香港(30M) => hk1.utools.club;
// 中国电信(100M) => cn1.utools.club;
{
  type: "directory",
  sub_domain: "denodemo",
  local_host: "127.0.0.1",
  domain: "cn1.utools.club",
  local_port: 8080,
  directory: "./"
}
`;

type Client = {
  type: "http" | "tcp" | "directory";
  sub_domain: string;
  local_host: string;
  domain: string;
  local_port: number;
  directory: string;
};

type Msg = {
  code: 0 | 1 | 500 | 201 | 202;
  msg: string;
  data: any;
};

class Denat {
  managerPort: number;
  type: "http" | "tcp" | "directory";
  domain: string;
  sub_domain: string;
  local_host: string;
  local_port: number;
  pingTime: number;
  message: string;
  token: string;
  tcpPort: number;
  manager?: Deno.Conn;
  staticServer: null;
  directory: string;
  constructor() {
    this.managerPort = 10000;
    this.pingTime = Date.now();
    this.message = "";
    this.token = "";
    this.tcpPort = 0;
    this.type = "http";
    this.domain = "";
    this.sub_domain = "";
    this.local_host = "";
    this.local_port = 0;
    this.directory = "";
  }

  async managerConnect(client: Client) {
    this.type = client.type;
    this.domain = client.domain;
    this.sub_domain = client.sub_domain;
    this.local_host = client.local_host;
    this.local_port = client.local_port;
    this.directory = client.directory || Deno.cwd();
    const manageConn = await Deno.connect(
      { hostname: this.domain, port: this.managerPort },
    );
    const message = {
      type: "tunnel",
      tunnel_type: this.type,
      sub_domain: this.sub_domain,
    };
    if (this.type === "directory") {
      this.local_port = await getFreePort(this.local_port);
      serve(this.directory, this.local_port);
    }
    await manageConn.write(encoder.encode(JSON.stringify(message) + "\r\n"));
    this.manager = manageConn;
    while (true) {
      await this.readManagerMessage();
    }
  }

  async connect(type: "client" | "tcpClient") {
    let serverConn;
    let clientConn;
    try {
      serverConn = await Deno.connect(
        { hostname: this.domain, port: this.managerPort },
      );

      await serverConn.write(encoder.encode(
        JSON.stringify({
          type: type,
          sub_domain: this.sub_domain,
          tcp_port: this.tcpPort,
          token: this.token,
        }) + "\r\n",
      ));

      clientConn = await Deno.connect(
        { hostname: this.local_host, port: this.local_port },
      );
      Deno.copy(serverConn, clientConn);
      await Deno.copy(clientConn, serverConn);
      clientConn.closeWrite();
      serverConn.closeWrite();
    } catch (e) {
      serverConn?.close();
      clientConn?.close();
      console.log("连接失败");
    }
  }

  async readManagerMessage() {
    const result = new Uint8Array(1024);
    await this.manager?.read(result);
    decoder.decode(result).split("\r\n").map((_msg) => {
      try {
        const msg = JSON.parse(_msg);
        this.parseManagerMessage(msg);
      } catch (e) {
      }
    });
  }

  parseManagerMessage(msg: Msg) {
    switch (msg.code) {
      case 0:
        this.tcpPort = msg.data.port ? parseInt(msg.data.port) : 0;
        if (this.tcpPort) {
          console.log("远程端口:", this.tcpPort);
        } else {
          console.log("远程地址：");
          console.log(`http://${this.sub_domain}.${this.domain}`);
          console.log(`https://${this.sub_domain}.${this.domain}`);
        }
        this.token = msg.data.token;
        this.pingTime = Date.now();
        this.ping();
        break;
      case 201:
        return this.connect("client");
      case 202:
        console.log(msg);
        return this.connect("tcpClient");
      default:
        return;
    }
  }
  ping() {
    if (this.pingTime + 25000 < Date.now() && this.manager) {
      this.pingTime = Date.now();
      this.manager.write(
        encoder.encode(
          JSON.stringify({
            type: "ping",
            sub_domain: this.sub_domain,
          }) + "\r\n",
        ),
      );
    }
    setTimeout(this.ping.bind(this), 1000);
  }
  async run() {
    const configExists = await exists("./config.json");
    if (!configExists) {
      await Deno.writeTextFile("./config.json.sample", CONFIG_SAMPLE);
      console.log("配置不存在，已生成配置实例于config.json.sample");
      console.log("请修改并重命名为config.json后重新运行");
    } else {
      const config = await Deno.readTextFile("./config.json");
      this.managerConnect(JSON.parse(config));
    }
  }
}

const denat = new Denat();
denat.run();
