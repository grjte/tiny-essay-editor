import {
  AutomergeUrl,
  DocHandle,
  Repo,
  isValidAutomergeUrl,
  parseAutomergeUrl,
} from "@automerge/automerge-repo";
import { useRepo, useDocument } from "@automerge/automerge-repo-react-hooks";
import { EventEmitter } from "eventemitter3";

import { useEffect, useReducer, useState } from "react";
import { uploadFile } from "./utils";
import { ChangeFn } from "@automerge/automerge/next";

import { FolderDoc, FolderDocWithChildren } from "../folders/datatype";
import { useFolderDocWithChildren } from "../folders/useFolderDocWithChildren";

import { Agent } from "@atproto/api";
import { BrowserOAuthClient, OAuthSession } from "@atproto/oauth-client-browser";
import { BrowserWebSocketClientAdapter } from "@automerge/automerge-repo-network-websocket";

export interface AccountDoc {
  contactUrl: AutomergeUrl;
  rootFolderUrl: AutomergeUrl;
  atprotoDid?: string;
  atprotoHandle?: string;
  pssJwt?: string;
  lastOnlineSync?: number;
}

export interface AnonymousContactDoc {
  type: "anonymous";
}

export interface RegisteredContactDoc {
  type: "registered";
  name: string;
  avatarUrl?: AutomergeUrl;
  atprotoProfile?: {
    displayName: string;
    handle: string;
    avatar?: string;
  };
}

export type ContactDoc = AnonymousContactDoc | RegisteredContactDoc;

interface AccountEvents {
  change: () => void;
}

interface ContactProps {
  name: string;
  avatar: File;
}

class Account extends EventEmitter<AccountEvents> {
  #client: BrowserOAuthClient;
  #repo: Repo;
  #handle: DocHandle<AccountDoc>;
  #contactHandle: DocHandle<ContactDoc>;
  #session?: OAuthSession;

  constructor(
    repo: Repo,
    handle: DocHandle<AccountDoc>,
    contactHandle: DocHandle<ContactDoc>
  ) {
    super();

    this.#repo = repo;
    this.#handle = handle;
    this.#contactHandle = contactHandle;

    // listen for changed accountUrl caused by other tabs
    window.addEventListener("storage", async (event) => {
      if (event.key === ACCOUNT_URL_STORAGE_KEY) {
        const newAccountUrl = event.newValue as AutomergeUrl;

        // try to see if account is already loaded
        const accountHandle = this.#repo.find<AccountDoc>(newAccountUrl);
        const accountDoc = await accountHandle.doc();
        if (accountDoc.contactUrl) {
          this.logIn(newAccountUrl);
          return;
        }

        // ... otherwise wait until contactUrl of account is loaded
        accountHandle.on("change", ({ doc }) => {
          if (doc.contactUrl) {
            this.logIn(newAccountUrl);
          }
        });
      }
    });

    // Initialize ATProto client and handle OAuth flow
    const client = new BrowserOAuthClient({
      clientMetadata: {
        "client_id": `${import.meta.env.VITE_APP_URL}/client-metadata.json`,
        "client_name": import.meta.env.VITE_APP_NAME,
        "client_uri": import.meta.env.VITE_APP_URL,
        "redirect_uris": [
          import.meta.env.VITE_APP_URL
        ],
        "scope": "atproto transition:generic",
        "grant_types": [
          "authorization_code",
          "refresh_token"
        ],
        "response_types": [
          "code"
        ],
        "token_endpoint_auth_method": "none",
        "application_type": "web",
        "dpop_bound_access_tokens": true
      },
      handleResolver: import.meta.env.VITE_ATPROTO_HANDLE_RESOLVER_URL,
    });

    // Initialize the OAuth client
    client.init().then((result) => {
      this.#client = client;
      if (result?.session) {
        this.#session = result.session;
        this.connectToPSS();
      }
      // TODO: handle token expiry/refresh
    }).catch((error) => {
      console.error("Failed to initialize OAuth client", error);
    });
  }

  async logIn(accountUrl: AutomergeUrl) {
    // override old accountUrl
    localStorage.setItem(ACCOUNT_URL_STORAGE_KEY, accountUrl);

    const accountHandle = this.#repo.find<AccountDoc>(accountUrl);
    const accountDoc = await accountHandle.doc();
    const contactHandle = this.#repo.find<ContactDoc>(accountDoc.contactUrl);

    this.#contactHandle = contactHandle;
    this.#handle = accountHandle;
    this.emit("change");
  }

  async signUp({ name, avatar }: ContactProps) {
    let avatarUrl: AutomergeUrl;
    if (avatar) {
      avatarUrl = await uploadFile(this.#repo, avatar);
    }

    this.contactHandle.change((contact: RegisteredContactDoc) => {
      contact.type = "registered";
      contact.name = name;

      if (avatarUrl) {
        contact.avatarUrl = avatarUrl;
      }
    });
  }

  async logOut() {
    const { accountHandle, contactHandle } = createAccount(this.#repo);

    localStorage.setItem(ACCOUNT_URL_STORAGE_KEY, accountHandle.url);

    this.#handle = accountHandle;
    this.#contactHandle = contactHandle;

    this.emit("change");
  }

  get handle() {
    return this.#handle;
  }

  get contactHandle() {
    return this.#contactHandle;
  }

  async loginWithAtProto(handleOrDid: string) {
    try {
      // Store current account URL in state
      const currentAccountUrl = this.#handle.url;

      // Handle OAuth flow
      const session = await this.#client.signInPopup(handleOrDid);
      this.#session = session;
      window.location.href = currentAccountUrl;

      // No need to manually restore the account URL as it's handled by the state parameter
      const agent = new Agent(session);
      const profile = await agent.getProfile({ actor: session.did });

      // Update account with ATProto credentials
      this.#handle.change((account) => {
        account.atprotoDid = session.did;
        account.atprotoHandle = profile.data.handle;
      });

      // Update contact info with ATProto profile
      this.#contactHandle.change((contact: RegisteredContactDoc) => {
        contact.type = "registered";
        contact.name = profile.data.displayName || profile.data.handle;
        contact.atprotoProfile = {
          displayName: profile.data.displayName,
          handle: profile.data.handle,
          avatar: profile.data.avatar,
        };
      });

      await this.connectToPSS();
    } catch (error) {
      console.error('ATProto login failed:', error);
      throw error;
    }
  }

  async connectToPSS() {
    try {
      const agent = new Agent(this.#session);
      const pdsResponse = await agent.com.atproto.repo.getRecord({
        repo: this.#session.did,
        collection: "xyz.groundmist.sync",
        rkey: this.#session.did,
      })
      if (pdsResponse.success) {
        const pssHost = (pdsResponse.data.value as {
          host: string
        }).host;
        console.log('PSS host:', pssHost);

        if (pssHost) {
          // Use the fetchHandler to make an authenticated request to the sync server to get a token
          const pssResponse = await this.#session.fetchHandler(`https://${pssHost}/authenticate`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              lexiconAuthorityDomain: "xyz.groundmist.notebook.essay",
              rootDocUrl: this.#handle.url
            }),
          });
          const data = await pssResponse.json();
          console.log('Server response:', data);

          if (data.rootDocUrl !== this.#handle.url) {
            const accountDoc = await this.#handle.doc();
            const contactHandle = this.#repo.find<RegisteredContactDoc>(accountDoc.contactUrl);
            const contactDoc = await contactHandle.doc();

            // TODO: handle merging the rootFolderUrls from the 2 accounts
            // replace the account for this user with the new one
            console.log("Root doc URL mismatch, logging out and logging in again...");
            this.logOut();
            this.logIn(data.rootDocUrl);

            // Update account with ATProto credentials and PSS token
            console.log("Updating account with ATProto credentials");
            this.#handle.change((account) => {
              account.atprotoDid = accountDoc.atprotoDid;
              account.atprotoHandle = accountDoc.atprotoHandle;
              account.pssJwt = data.token;
            });

            // Update contact info with ATProto profile
            this.#contactHandle.change((contact: RegisteredContactDoc) => {
              contact.type = "registered";
              contact.name = contactDoc.name;
              contact.atprotoProfile = contactDoc.atprotoProfile;
            });
          } else {
            // Update account with PSS token
            this.#handle.change((account) => {
              account.pssJwt = data.token;
            });
          }

          // connect to the sync server using the access token
          console.log(this.#repo)
          console.log("Connecting to sync server...");
          this.#repo.networkSubsystem.addNetworkAdapter(
            new BrowserWebSocketClientAdapter(`wss://${pssHost}?token=${data.token}`)
          );
          console.log("Connected to sync server");
        }
      }
    } catch (error) {
      // silently fail if the sync server is not found
    }
  }

  async publishToPDS(docUrl: AutomergeUrl, doc: { content: string, title: string }) {
    if (!this.#session) {
      throw new Error("Not connected to Bluesky");
    }

    try {

      const agent = new Agent(this.#session);
      const entryCreate = {
        $type: 'com.atproto.repo.applyWrites#create',
        // TODO: create lexicon for collection
        collection: 'xyz.groundmist.notebook.essay',
        // TODO: use a better rkey
        rkey: docUrl,
        value: {
          text: doc.content,
          title: doc.title,
          createdAt: new Date().toISOString(),
        },
      }

      let writes = [entryCreate as any];

      await agent.com.atproto.repo.applyWrites({
        repo: this.#session.did,
        writes,
      });
      // TODO: update local docs to mark as published
    } catch (error) {
      console.error('Failed to publish to PDS', error);
      throw error;
    }
  }
}

const ACCOUNT_URL_STORAGE_KEY = "tinyEssayEditor:accountUrl";

let CURRENT_ACCOUNT: Promise<Account>;

export async function getAccount(repo: Repo) {
  if (!repo.storageSubsystem) {
    throw new Error("cannot create account without storage");
  }

  if (CURRENT_ACCOUNT) {
    const currentAccount = await CURRENT_ACCOUNT;
    if (currentAccount) {
      return currentAccount;
    }
  }

  const accountUrl = localStorage.getItem(
    ACCOUNT_URL_STORAGE_KEY
  ) as AutomergeUrl;

  // try to load existing account
  if (accountUrl) {
    CURRENT_ACCOUNT = new Promise<Account>(async (resolve) => {
      const accountHandle = repo.find<AccountDoc>(accountUrl);
      const contactHandle = repo.find<ContactDoc>(
        (await accountHandle.doc()).contactUrl
      );

      resolve(new Account(repo, accountHandle, contactHandle));
    });

    return CURRENT_ACCOUNT;
  }

  // ... otherwise create a new one
  const { accountHandle, contactHandle } = createAccount(repo);

  localStorage.setItem(ACCOUNT_URL_STORAGE_KEY, accountHandle.url);
  const newAccount = new Account(repo, accountHandle, contactHandle);
  CURRENT_ACCOUNT = Promise.resolve(newAccount);
  return newAccount;
}

const createAccount = (
  repo: Repo
): {
  accountHandle: DocHandle<AccountDoc>;
  contactHandle: DocHandle<ContactDoc>;
  rootFolderHandle: DocHandle<FolderDoc>;
} => {
  const accountHandle = repo.create<AccountDoc>();
  const contactHandle = repo.create<ContactDoc>();
  const rootFolderHandle = repo.create<FolderDoc>();

  contactHandle.change((contact) => {
    contact.type = "anonymous";
  });

  rootFolderHandle.change((rootFolder) => {
    rootFolder.docs = [];
  });

  accountHandle.change((account) => {
    account.contactUrl = contactHandle.url;
    account.rootFolderUrl = rootFolderHandle.url;
  });

  return { accountHandle, contactHandle, rootFolderHandle };
};

function useForceUpdate() {
  const [, forceUpdate] = useReducer((x) => x + 1, 0);
  return forceUpdate;
}

export function useCurrentAccount(): Account | undefined {
  const repo = useRepo();
  const [account, setAccount] = useState<Account | undefined>(undefined);

  // @ts-expect-error useful for debugging
  window.currentAccount = account;

  const forceUpdate = useForceUpdate();

  useEffect(() => {
    getAccount(repo).then(setAccount);
  }, [repo]);

  useEffect(() => {
    if (!account) {
      return;
    }

    account.on("change", forceUpdate);

    return () => {
      account.off("change", forceUpdate);
    };
  }, [account]);

  // Add a root folder to an old account doc that doesn't have one yet.
  // In the future, replace this with a more principled schema migration system.
  useEffect(() => {
    const doc = account?.handle.docSync();
    if (doc && doc.rootFolderUrl === undefined) {
      const rootFolderHandle = repo.create<FolderDoc>();
      rootFolderHandle.change((rootFolder) => {
        rootFolder.docs = [];
      });
      account.handle.change((account) => {
        account.rootFolderUrl = rootFolderHandle.url;
      });
    }
  }, [account?.handle.docSync()]);

  return account;
}

export function useCurrentAccountDoc(): [
  AccountDoc,
  (changeFn: ChangeFn<AccountDoc>) => void
] {
  const account = useCurrentAccount();
  const [accountDoc, changeAccountDoc] = useDocument<AccountDoc>(
    account?.handle.url
  );
  return [accountDoc, changeAccountDoc];
}

export function useRootFolderDocWithChildren() {
  const [accountDoc] = useCurrentAccountDoc();

  // debugging aid: put root folder handle on window
  const repo = useRepo();
  useEffect(() => {
    if (accountDoc) {
      // @ts-ignore
      window.rootFolderHandle = repo.find<FolderDoc>(accountDoc.rootFolderUrl);
    }
  }, [repo, accountDoc]);

  return useFolderDocWithChildren(accountDoc?.rootFolderUrl);
}

export function useSelf(): ContactDoc {
  const [accountDoc] = useCurrentAccountDoc();
  const [contactDoc] = useDocument<ContactDoc>(accountDoc?.contactUrl);

  return contactDoc;
}

// Helpers to convert an automerge URL to/from an Account Token that the user can
// paste in to login on another device.
// The doc ID is the only part of the URL actually used by the system,
// the rest is just for humans to understand what this string is for.
export function automergeUrlToAccountToken(
  url: AutomergeUrl,
  name: string
): string {
  const { documentId } = parseAutomergeUrl(url);
  return `account:${encodeURIComponent(name)}/${documentId}`;
}

// returns undefined if the token can't be parsed as an automerge URL
export function accountTokenToAutomergeUrl(
  token: string
): AutomergeUrl | undefined {
  const match = token.match(/^account:([^/]+)\/(.+)$/);
  if (!match || !match[2]) {
    return undefined;
  }
  const documentId = match[2];
  const url = `automerge:${documentId}`;
  if (!isValidAutomergeUrl(url)) {
    return undefined;
  }
  return url;
}