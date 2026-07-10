const REMOTE_SERVERS_KEY = 'taskcooker.remoteServers';

export type RemoteServerInput = {
  sshHost: string;
  serverPort: number;
  remotePath: string;
};

export type RemoteConnectionState = RemoteServerInput & {
  baseUrl: string;
};

export function loadRecentRemoteServers(): RemoteServerInput[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(REMOTE_SERVERS_KEY) ?? '[]');
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((item): item is RemoteServerInput =>
        Boolean(
          item &&
            typeof item.sshHost === 'string' &&
            typeof item.serverPort === 'number' &&
            typeof item.remotePath === 'string',
        ),
      )
      .slice(0, 5);
  } catch {
    return [];
  }
}

export function saveRecentRemoteServer(server: RemoteServerInput): RemoteServerInput[] {
  const recent = [
    server,
    ...loadRecentRemoteServers().filter(
      (item) =>
        item.sshHost !== server.sshHost ||
        item.serverPort !== server.serverPort ||
        item.remotePath !== server.remotePath,
      ),
  ].slice(0, 5);
  try {
    window.localStorage.setItem(REMOTE_SERVERS_KEY, JSON.stringify(recent));
  } catch {
    // localStorage can be unavailable in private or restricted webviews.
  }
  return recent;
}
