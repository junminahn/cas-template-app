import type { Request, Response } from "express";
import { BaseClient, TokenSet, generators } from "openid-client";
import { mocked } from "ts-jest/utils";
import { SSOExpressOptions } from "../src";
import {
  authCallbackController,
  loginController,
  logoutController,
  sessionIdleRemainingTimeController,
  tokenSetController,
} from "../src/controllers";
import { isAuthenticated, getSessionRemainingTime } from "../src/helpers";
jest.mock("../src/helpers");
jest.mock("openid-client");

const oidcIssuer = "https://example.com/auth/realms/myRealm";
const middlewareOptions: SSOExpressOptions = {
  applicationDomain: ".gov.bc.ca",
  oidcConfig: {
    baseUrl: "https://example.com",
    clientId: "myClient",
    oidcIssuer,
  },
  getLandingRoute: jest.fn(),
};

const client = {
  metadata: {
    post_logout_redirect_uris: ["https://example.com/"],
    redirect_uris: ["https://example.com/auth-callback"],
  },
  endSessionUrl: () => "https://oidc-endpoint/logout",
  refresh: jest.fn(),
  authorizationUrl: jest.fn(),
  callbackParams: jest.fn(),
  callback: jest.fn(),
} as unknown as BaseClient;

describe("the postLogout controller", () => {
  it("clears the SMSESSION cookie", async () => {
    const res = {
      clearCookie: jest.fn(),
      redirect: jest.fn(),
    } as unknown as Response;

    const handler = logoutController(client, middlewareOptions);

    const req = {} as Request;
    await handler(req, res);
    expect(res.clearCookie).toHaveBeenCalledWith("SMSESSION", {
      domain: ".gov.bc.ca",
      secure: true,
    });
  });

  it("redirects to the base url if the user is already logged out", async () => {
    const res = {
      clearCookie: jest.fn(),
      redirect: jest.fn(),
    } as unknown as Response;

    const handler = logoutController(client, middlewareOptions);

    const req = {} as Request;
    await handler(req, res);
    expect(res.redirect).toHaveBeenCalledWith("https://example.com/");
  });

  it("redirects to the provider's logout endpoint if the user is authenticated", async () => {
    const res = {
      clearCookie: jest.fn(),
      redirect: jest.fn(),
    } as unknown as Response;

    const handler = logoutController(client, middlewareOptions);

    const req = {
      session: { tokenSet: {} },
    } as Request;
    mocked(isAuthenticated).mockReturnValue(true);
    await handler(req, res);
    expect(res.redirect).toHaveBeenCalledWith("https://oidc-endpoint/logout");
  });

  it("removes the tokenset from the session", async () => {
    const res = {
      clearCookie: jest.fn(),
      redirect: jest.fn(),
    } as unknown as Response;

    const handler = logoutController(client, middlewareOptions);

    const req = {
      session: { tokenSet: {} },
    } as Request;
    mocked(isAuthenticated).mockReturnValue(true);
    await handler(req, res);
    expect(req.session).toEqual({});
  });
});

describe("the tokenSet controller", () => {
  it("tries to refresh the access token if it is expired", async () => {
    mocked(isAuthenticated).mockReturnValue(true);
    const req = {
      session: { tokenSet: {} },
      claims: undefined,
    } as Request;
    const res = {} as Response;
    const next = jest.fn();

    const expiredTokenSet = {
      expired: () => true,
      claims: jest.fn(),
    } as TokenSet;

    const newClaims = {};

    const newTokenSet = {
      expired: () => false,
      claims: jest.fn().mockReturnValue(newClaims),
    } as TokenSet;

    mocked(TokenSet).mockImplementation(() => expiredTokenSet);
    mocked(client.refresh).mockResolvedValue(newTokenSet);

    const handler = tokenSetController(client, middlewareOptions);
    await handler(req, res, next);
    expect(client.refresh).toHaveBeenCalledWith(expiredTokenSet);
    expect(expiredTokenSet.claims).toHaveBeenCalledTimes(0);
    expect(newTokenSet.claims).toHaveBeenCalled();
    expect(req.session.tokenSet).toEqual(newTokenSet);
    expect(req.claims).toBe(newClaims);
    expect(next).toHaveBeenCalled();
  });

  it("only adds the claims to the request if the token set is not expired", async () => {
    mocked(isAuthenticated).mockReturnValue(true);
    const req = {
      session: { tokenSet: {} },
      claims: undefined,
    } as Request;
    const res = {} as Response;
    const next = jest.fn();

    const newClaims = {};

    const tokenSet = {
      expired: () => false,
      claims: jest.fn().mockReturnValue(newClaims),
    } as TokenSet;

    mocked(TokenSet).mockImplementation(() => tokenSet);

    const handler = tokenSetController(client, middlewareOptions);
    await handler(req, res, next);
    expect(client.refresh).toHaveBeenCalledTimes(0);
    expect(tokenSet.claims).toHaveBeenCalledTimes(1);
    expect(req.session.tokenSet).toEqual(tokenSet);
    expect(req.claims).toBe(newClaims);
    expect(next).toHaveBeenCalled();
  });

  it("removes the token set from the session if the token refresh fails", async () => {
    mocked(isAuthenticated).mockReturnValue(true);
    const req = {
      session: { tokenSet: {} },
      claims: undefined,
    } as Request;
    const res = {} as Response;
    const next = jest.fn();

    const expiredTokenSet = {
      expired: () => true,
      claims: jest.fn(),
    } as TokenSet;

    mocked(TokenSet).mockImplementation(() => expiredTokenSet);
    mocked(client.refresh).mockRejectedValue(new Error("refresh failed"));

    const handler = tokenSetController(client, middlewareOptions);
    await handler(req, res, next);
    expect(client.refresh).toHaveBeenCalledWith(expiredTokenSet);
    expect(req.session.tokenSet).toBeUndefined();
    expect(req.claims).toBeUndefined();
    expect(next).toHaveBeenCalled();
  });
});

describe("the sessionIdleRemainingTimeController", () => {
  it("returns the remaining time", async () => {
    const handler = sessionIdleRemainingTimeController(
      client,
      middlewareOptions
    );
    const req = {} as Request;
    const res = {
      json: jest.fn(),
    } as unknown as Response;
    mocked(getSessionRemainingTime).mockReturnValue(123);
    await handler(req, res);
    expect(res.json).toHaveBeenCalledWith(123);
  });

  it("returns a mocked time if authentication is bypassed", async () => {
    const handler = sessionIdleRemainingTimeController(client, {
      ...middlewareOptions,
      bypassAuthentication: { sessionIdleRemainingTime: true },
    });
    const req = {} as Request;
    const res = {
      json: jest.fn(),
    } as unknown as Response;
    mocked(getSessionRemainingTime).mockReturnValue(123);
    await handler(req, res);
    expect(res.json).toHaveBeenCalledWith(3600);
  });
});

describe("the loginController", () => {
  it("redirects to the landing route if the user is already logged in", async () => {
    mocked(isAuthenticated).mockReturnValue(true);
    mocked(middlewareOptions.getLandingRoute).mockReturnValue("/landing");
    const handler = loginController(client, middlewareOptions);
    const req = {} as Request;
    const res = {
      redirect: jest.fn(),
    } as unknown as Response;
    await handler(req, res);
    expect(middlewareOptions.getLandingRoute).toHaveBeenCalledWith(req);
    expect(res.redirect).toHaveBeenCalledWith(302, "/landing");
  });

  it("redirects to the landing route if authentication is bypassed", async () => {
    mocked(isAuthenticated).mockReturnValue(false);
    mocked(middlewareOptions.getLandingRoute).mockReturnValue("/landing");
    const handler = loginController(client, {
      ...middlewareOptions,
      bypassAuthentication: { login: true },
    });
    const req = {} as Request;
    const res = {
      redirect: jest.fn(),
    } as unknown as Response;
    await handler(req, res);
    expect(middlewareOptions.getLandingRoute).toHaveBeenCalledWith(req);
    expect(res.redirect).toHaveBeenCalledWith(302, "/landing");
  });

  it("adds a randomly-generated OpenID state to the session", async () => {
    mocked(isAuthenticated).mockReturnValue(false);
    mocked(generators.random).mockReturnValue("some-random-state");
    const handler = loginController(client, middlewareOptions);
    const req = { session: {} } as Request;
    const res = {
      redirect: jest.fn(),
    } as unknown as Response;
    await handler(req, res);
    expect(generators.random).toHaveBeenCalledWith(32);
    expect(req.session.oidcState).toBe("some-random-state");
  });

  it("redirects the user to the provider's auth URL", async () => {
    mocked(isAuthenticated).mockReturnValue(false);
    mocked(generators.random).mockReturnValue("some-random-state");
    mocked(client.authorizationUrl).mockReturnValue("https://auth.url");
    const handler = loginController(client, middlewareOptions);
    const req = { session: {} } as Request;
    const res = {
      redirect: jest.fn(),
    } as unknown as Response;
    await handler(req, res);

    expect(client.authorizationUrl).toHaveBeenCalledWith({
      state: "some-random-state",
    });
    expect(res.redirect).toHaveBeenCalledWith("https://auth.url");
  });
});

describe("the authCallbackController", () => {
  it("checks if the OpenID state of the request matches the session's", async () => {
    const handler = authCallbackController(client, middlewareOptions);
    const req = {
      session: { oidcState: "some-state" },
      query: {
        state: "some-other-state",
      },
    } as unknown as Request;
    const res = {
      redirect: jest.fn(),
    } as unknown as Response;
    const next = jest.fn();

    await handler(req, res, next);

    expect(req.session.oidcState).toBe(undefined);
    expect(res.redirect).toHaveBeenCalledWith(
      middlewareOptions.oidcConfig.baseUrl
    );
    expect(client.callback).toHaveBeenCalledTimes(0);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("fetches the tokenSet and redirects to the landing route", async () => {
    const handler = authCallbackController(client, middlewareOptions);
    const req = {
      session: { oidcState: "some-state" },
      query: {
        state: "some-state",
      },
    } as unknown as Request;
    const res = {
      redirect: jest.fn(),
    } as unknown as Response;
    const next = jest.fn();

    const claims = {};
    const callbackParams = {};
    const tokenSet = {
      claims: jest.fn().mockReturnValue(claims),
    } as unknown as TokenSet;
    mocked(client.callbackParams).mockReturnValue(callbackParams);
    mocked(client.callback).mockResolvedValue(tokenSet);
    mocked(middlewareOptions.getLandingRoute).mockReturnValue("/landing");

    await handler(req, res, next);

    expect(req.session.oidcState).toBe(undefined);
    expect(res.redirect).toHaveBeenCalledWith("/landing");
    expect(client.callbackParams).toHaveBeenCalledWith(req);
    expect(tokenSet.claims).toHaveBeenCalled();
    expect(client.callback).toHaveBeenCalledWith(
      client.metadata.redirect_uris[0],
      callbackParams,
      {
        state: "some-state",
      }
    );
    expect(req.claims).toBe(claims);
    expect(req.session.tokenSet).toBe(tokenSet);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("redirects to the base URL if it cannot fetch the tokenSet", async () => {
    const handler = authCallbackController(client, middlewareOptions);
    const req = {
      session: { oidcState: "some-state" },
      query: {
        state: "some-state",
      },
    } as unknown as Request;
    const res = {
      redirect: jest.fn(),
    } as unknown as Response;
    const next = jest.fn();

    const callbackParams = {};

    mocked(client.callbackParams).mockReturnValue(callbackParams);
    mocked(client.callback).mockRejectedValue(new Error("some-error"));

    await handler(req, res, next);

    expect(req.session.oidcState).toBe(undefined);
    expect(res.redirect).toHaveBeenCalledWith(
      middlewareOptions.oidcConfig.baseUrl
    );
    expect(client.callbackParams).toHaveBeenCalledWith(req);
    expect(client.callback).toHaveBeenCalledWith(
      client.metadata.redirect_uris[0],
      callbackParams,
      {
        state: "some-state",
      }
    );
    expect(req.claims).toBe(undefined);
    expect(req.session.tokenSet).toBe(undefined);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
