import {
  ContactDoc,
  AccountDoc,
  useCurrentAccount,
  useSelf,
  automergeUrlToAccountToken,
  accountTokenToAutomergeUrl,
} from "../account";
import { ChangeEvent, useEffect, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTrigger,
} from "@/components/ui/dialog";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { useDocument } from "@automerge/automerge-repo-react-hooks";

import { Copy, Eye, EyeOff } from "lucide-react";

import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ContactAvatar } from "./ContactAvatar";

// 1MB in bytes
const MAX_AVATAR_SIZE = 1024 * 1024;

enum AccountPickerTab {
  LogIn = "logIn",
  SignUp = "signUp",
  ATProto = "atProto",
}

type AccountTokenToLoginStatus = null | "valid" | "malformed" | "not-found";

export const AccountPicker = ({
  showName,
  size = "default",
}: {
  showName?: boolean;
  size?: "default" | "sm" | "lg";
}) => {
  const currentAccount = useCurrentAccount();

  const self = useSelf();
  const [name, setName] = useState<string>("");
  const [avatar, setAvatar] = useState<File>();
  const [activeTab, setActiveTab] = useState<AccountPickerTab>(
    AccountPickerTab.ATProto
  );
  const [showAccountUrl, setShowAccountUrl] = useState(false);
  const [isCopyTooltipOpen, setIsCopyTooltipOpen] = useState(false);

  const [accountTokenToLogin, setAccountTokenToLogin] = useState<string>("");
  const accountAutomergeUrlToLogin = accountTokenToLogin
    ? accountTokenToAutomergeUrl(accountTokenToLogin)
    : undefined;

  const [accountToLogin] = useDocument<AccountDoc>(accountAutomergeUrlToLogin);
  const [contactToLogin] = useDocument<ContactDoc>(accountToLogin?.contactUrl);

  const accountTokenToLoginStatus: AccountTokenToLoginStatus = (() => {
    if (!accountTokenToLogin || accountTokenToLogin === "") return null;
    if (!accountAutomergeUrlToLogin) return "malformed";
    if (!accountToLogin) return "not-found";
    if (!contactToLogin) return "not-found";
    return "valid";
  })();

  const currentAccountToken = currentAccount
    ? automergeUrlToAccountToken(currentAccount.handle.url, name)
    : null;

  const [atprotoHandle, setAtprotoHandle] = useState<string>("");

  // initialize form values if already logged in
  useEffect(() => {
    if (self && self.type === "registered" && name === "") {
      setName(self.name);
    }
  }, [self]);

  const onSubmit = async () => {
    switch (activeTab) {
      case AccountPickerTab.LogIn:
        currentAccount.logIn(accountAutomergeUrlToLogin);
        break;

      case AccountPickerTab.SignUp:
        currentAccount.signUp({ name, avatar });
        break;

      case AccountPickerTab.ATProto:
        try {
          await currentAccount.loginWithAtProto(atprotoHandle);
        } catch (error) {
          console.error('ATProto login failed:', error);
        }
        break;
    }
  };

  const onLogout = () => {
    currentAccount.logOut();
  };

  const onFilesChanged = (e: ChangeEvent<HTMLInputElement>) => {
    const avatarFile = !e.target.files ? undefined : e.target.files[0];
    if (avatarFile.size > MAX_AVATAR_SIZE) {
      alert("Avatar is too large. Please choose a file under 1MB.");
      e.target.value = "";
      return;
    }
    setAvatar(avatarFile);
  };

  const onToggleShowAccountUrl = () => {
    setShowAccountUrl((showAccountUrl) => !showAccountUrl);
  };

  const onCopy = () => {
    navigator.clipboard.writeText(currentAccountToken);

    setIsCopyTooltipOpen(true);

    setTimeout(() => {
      setIsCopyTooltipOpen(false);
    }, 1000);
  };

  const isSubmittable =
    (activeTab === AccountPickerTab.SignUp && name) ||
    (activeTab === AccountPickerTab.LogIn &&
      accountTokenToLogin &&
      accountToLogin?.contactUrl &&
      contactToLogin?.type === "registered") ||
    (activeTab === AccountPickerTab.ATProto && atprotoHandle);

  const isLoggedIn = self?.type === "registered";

  return (
    <Dialog>
      <DialogTrigger data-testid="account-picker-trigger">
        <div className="flex flex-row  text-sm text-gray-600 hover:text-gray-800 ">
          <ContactAvatar url={currentAccount?.contactHandle.url} size={size} />
          {showName && isLoggedIn && <div className="ml-2 py-2">{name}</div>}
          {showName && !isLoggedIn && <div className="ml-2 py-2">Sign in</div>}
        </div>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]" data-testid="account-picker-dialog">
        <DialogHeader className="items-center">
          {isLoggedIn ? (
            <div className="flex flex-col items-center gap-2">
              <ContactAvatar
                size="default"
                url={currentAccount?.contactHandle.url}
                name={name}
                avatar={avatar}
              />
              {self?.atprotoProfile && (
                <div className="text-sm text-blue-600">
                  Connected to @{self.atprotoProfile.handle}
                </div>
              )}
            </div>
          ) : activeTab === "signUp" ? (
            <ContactAvatar name={name} avatar={avatar} size={"lg"} />
          ) : activeTab === "atProto" ? (
            <div className="p-4 flex flex-row items-center gap-2 text-blue-500">
              <svg className="w-5 h-auto" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 568 501"><title>Bluesky butterfly logo</title><path fill="currentColor" d="M123.121 33.664C188.241 82.553 258.281 181.68 284 234.873c25.719-53.192 95.759-152.32 160.879-201.21C491.866-1.611 568-28.906 568 57.947c0 17.346-9.945 145.713-15.778 166.555-20.275 72.453-94.155 90.933-159.875 79.748C507.222 323.8 536.444 388.56 473.333 453.32c-119.86 122.992-172.272-30.859-185.702-70.281-2.462-7.227-3.614-10.608-3.631-7.733-.017-2.875-1.169.506-3.631 7.733-13.43 39.422-65.842 193.273-185.702 70.281-63.111-64.76-33.89-129.52 80.986-149.071-65.72 11.185-139.6-7.295-159.875-79.748C9.945 203.659 0 75.291 0 57.946 0-28.906 76.135-1.612 123.121 33.664Z"></path></svg> Bluesky
            </div>
          ) : (
            <ContactAvatar url={accountToLogin?.contactUrl} size="lg" />
          )}
        </DialogHeader>

        {!isLoggedIn && (
          <Tabs
            defaultValue={AccountPickerTab.ATProto}
            className="w-full"
            onValueChange={(tab) => setActiveTab(tab as AccountPickerTab)}
            value={activeTab}
          >
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value={AccountPickerTab.SignUp}>Sign up</TabsTrigger>
              <TabsTrigger value={AccountPickerTab.LogIn}>Log in</TabsTrigger>
              <TabsTrigger value={AccountPickerTab.ATProto} data-testid="account-picker-atproto-tab">
                Bluesky
              </TabsTrigger>
            </TabsList>
            <TabsContent value={AccountPickerTab.SignUp}>
              <div className="grid w-full max-w-sm items-center gap-1.5 py-4">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(evt) => setName(evt.target.value)}
                />
              </div>

              <div className="grid w-full max-w-sm items-center gap-1.5">
                <Label htmlFor="picture">Avatar</Label>
                <Input
                  id="avatar"
                  type="file"
                  accept="image/*"
                  onChange={onFilesChanged}
                />
              </div>
            </TabsContent>
            <TabsContent value={AccountPickerTab.LogIn}>
              <form className="grid w-full max-w-sm items-center gap-1.5 py-4">
                <Label htmlFor="accountUrl">Account token</Label>

                <div className="flex gap-1.5">
                  <Input
                    className={`${accountTokenToLoginStatus === "valid"
                      ? "bg-green-100"
                      : ""
                      }`}
                    id="accountUrl"
                    value={accountTokenToLogin}
                    onChange={(evt) => {
                      setAccountTokenToLogin(evt.target.value);
                    }}
                    type={showAccountUrl ? "text" : "password"}
                    autoComplete="current-password"
                  />
                  <Button variant="ghost" onClick={onToggleShowAccountUrl}>
                    {showAccountUrl ? <Eye /> : <EyeOff />}
                  </Button>
                </div>

                <div className="h-8 text-sm text-red-500">
                  {accountTokenToLoginStatus === "malformed" && (
                    <div>
                      Not a valid account token, try copy-pasting again.
                    </div>
                  )}
                  {accountTokenToLoginStatus === "not-found" && (
                    <div>Account not found</div>
                  )}
                </div>

                <p className="text-gray-500 text-justify pb-2 text-sm">
                  To login, paste your account token.
                </p>
                <p className="text-gray-500 text-justify pb-2 text-sm mb-2">
                  You can find your token by accessing the account dialog on any
                  device where you are currently logged in.
                </p>
              </form>
            </TabsContent>
            <TabsContent value={AccountPickerTab.ATProto}>
              <form className="grid w-full max-w-sm items-center gap-1.5 py-4">
                <Label htmlFor="atprotoHandle">Bluesky Handle</Label>
                <Input
                  id="atprotoHandle"
                  value={atprotoHandle}
                  onChange={(evt) => setAtprotoHandle(evt.target.value)}
                  placeholder="handle.bsky.social"
                />

                <p className="text-gray-500 text-justify pb-2 text-sm mt-4">
                  Connect with your Bluesky account to publish documents to your PDS.
                </p>
              </form>
            </TabsContent>
          </Tabs>
        )}

        {isLoggedIn && (
          <>
            <div className="grid w-full max-w-sm items-center gap-1.5 py-4">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(evt) => setName(evt.target.value)}
              />
            </div>

            <div className="grid w-full max-w-sm items-center gap-1.5">
              <Label htmlFor="picture">Avatar</Label>
              <Input
                id="avatar"
                type="file"
                accept="image/*"
                onChange={onFilesChanged}
              />
            </div>

            <form className="grid w-full max-w-sm items-center gap-1.5">
              <Label htmlFor="picture">Account token</Label>

              <div className="flex gap-1.5">
                <Input
                  onFocus={(e) => e.target.select()}
                  value={currentAccountToken}
                  id="accountUrl"
                  type={showAccountUrl ? "text" : "password"}
                  accept="image/*"
                  onChange={onFilesChanged}
                  autoComplete="off"
                />

                <Button
                  variant="ghost"
                  onClick={onToggleShowAccountUrl}
                  type="button"
                >
                  {showAccountUrl ? <Eye /> : <EyeOff />}
                </Button>

                <TooltipProvider>
                  <Tooltip open={isCopyTooltipOpen}>
                    <TooltipTrigger
                      type="button"
                      onClick={onCopy}
                      onBlur={() => setIsCopyTooltipOpen(false)}
                    >
                      <Copy />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Copied</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>

              <p className="text-gray-500 text-justify pt-2 text-sm">
                To log in on another device, copy your account token and paste
                it into the login screen on the other device.
              </p>
              <p className="text-gray-500 text-justify pt-2 text-sm">
                ⚠️ WARNING: this app has limited security, don't use it for
                private docs.
              </p>
            </form>
          </>
        )}
        <DialogFooter className="gap-1.5">
          {isLoggedIn && (
            <DialogTrigger asChild>
              <Button onClick={onLogout} variant="secondary">
                Sign out
              </Button>
            </DialogTrigger>
          )}
          <DialogTrigger asChild>
            <Button type="submit" onClick={onSubmit} disabled={!isSubmittable}>
              {isLoggedIn
                ? "Save"
                : activeTab === "signUp"
                  ? "Sign up"
                  : activeTab === "atProto"
                    ? "Connect"
                    : `Log in${contactToLogin && contactToLogin.type === "registered"
                      ? ` as ${contactToLogin.name}`
                      : ""
                    }`}
            </Button>
          </DialogTrigger>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
