## Purpose

How a third-party application connects to a user's HearthShelf server(s): how it
registers, how the user authorizes it and chooses what it may reach, how it
exercises that authorization, and how the user takes it away again.

Written app-agnostically. Audplexus is the first client but is never a special
case - anything stated here holds for any application.

## ADDED Requirements

### Requirement: Self-hosted apps register themselves

An application that each user runs their own copy of (an **instance app**) SHALL
be able to register itself, without its user visiting a developer console and
without any approval step. Each running instance SHALL receive its own `app_id`
and its own secret; instances SHALL NOT share a credential.

Registration by itself SHALL NOT grant access to any server or any user's data.
It only creates an identity capable of *asking*.

#### Scenario: An instance registers on first boot
- **WHEN** a freshly installed instance app starts for the first time
- **THEN** it registers itself and receives its own `app_id` and secret
- **AND** its user is not asked to visit a developer console

#### Scenario: Two installations are separate identities
- **WHEN** two users each run their own instance of the same software
- **THEN** each holds a distinct credential
- **AND** neither can act with the other's

#### Scenario: Registration grants nothing on its own
- **WHEN** a freshly registered app presents its credentials without any user
  having authorized it
- **THEN** it can reach no server and read no user's data

#### Scenario: Rejecting an unknown scope
- **WHEN** a registration requests a scope outside the defined set
- **THEN** the registration is rejected naming the offending scope

### Requirement: An instance app is authorizable only by the account that runs it

An instance app SHALL be authorizable only by the account that registered it.

This is the boundary that makes open registration safe. It SHALL be enforced
before the consent screen is shown, so an app claiming a familiar name can never
be presented to a user who does not run it.

#### Scenario: The operator authorizes their own instance
- **WHEN** the account running an instance app authorizes it against their server
- **THEN** the authorization succeeds

#### Scenario: Someone else cannot authorize it
- **WHEN** a different user enters a code for an instance app they do not run
- **THEN** the attempt is refused before any consent screen is shown
- **AND** no authorization is recorded

#### Scenario: An instance app cannot be listed
- **WHEN** an instance app is submitted for store review
- **THEN** the submission is refused

### Requirement: Cloud apps register once and are reviewed

An application run as a single hosted service for many users (a **cloud app**)
SHALL be registered once by its developer in a developer console, and SHALL be
reviewed by a platform admin before any other user can connect it.

#### Scenario: Registering a cloud app
- **WHEN** a developer registers a cloud app with a name and requested scopes
- **THEN** an `app_id` and client secret are returned
- **AND** the secret is shown exactly once and stored only as a hash
- **AND** it is not yet visible to other users

#### Scenario: Only the owner sees an unlisted app
- **WHEN** a developer opens their console
- **THEN** they see the apps they own
- **AND** no app owned by anyone else

#### Scenario: Rotating a leaked secret
- **WHEN** the owner rotates their app's client secret
- **THEN** a new secret is issued and shown once
- **AND** the previous secret stops working

#### Scenario: Deleting an app
- **WHEN** the owner deletes an app
- **THEN** every authorization anyone held for it stops working

### Requirement: Store submission and review

A developer SHALL be able to submit a cloud app for review, and a platform admin
SHALL be able to approve it into the store or reject it with a reason. Only an
approved app SHALL appear in the store.

Approval SHALL be recorded in the platform admin audit trail.

#### Scenario: Submitting for review
- **WHEN** a developer submits an unlisted cloud app for review
- **THEN** it is marked as pending review
- **AND** it remains usable by its owner meanwhile

#### Scenario: Approving into the store
- **WHEN** a platform admin approves a pending app
- **THEN** it appears in the store for all users
- **AND** the approval is written to the admin audit trail

#### Scenario: Rejecting a submission
- **WHEN** a platform admin rejects a pending app with a reason
- **THEN** the developer can see the reason
- **AND** the app returns to unlisted, still working for its owner

#### Scenario: Only platform admins review
- **WHEN** a user who is not a platform admin attempts to approve an app
- **THEN** the attempt is refused

#### Scenario: Removing an app from the store
- **WHEN** a platform admin removes a listed app from the store
- **THEN** it stops appearing to other users
- **AND** existing authorizations already granted for it continue to work

#### Scenario: Changing scopes after listing
- **WHEN** a listed app's requested scopes are broadened
- **THEN** it returns to pending review
- **AND** it stops appearing in the store until approved again

### Requirement: Browsing the store

A user SHALL be able to browse store-listed apps and start a connection from
there, without a code supplied out of band.

#### Scenario: Connecting from the store
- **WHEN** a user chooses a store app and starts a connection
- **THEN** they reach the same consent screen, naming the app and its scopes

#### Scenario: The store shows only approved apps
- **WHEN** a user browses the store
- **THEN** only approved cloud apps are listed
- **AND** no unlisted, pending, or instance app appears

### Requirement: Servers advertise their authorization server

A HearthShelf server SHALL publish metadata at
`/.well-known/oauth-protected-resource` naming the control plane as its
authorization server, so an application pointed at any server can discover how to
connect without prior HearthShelf-specific knowledge.

#### Scenario: Discovering how to connect
- **WHEN** an application fetches the metadata document from a server's origin
- **THEN** it learns the authorization server URL and the supported scopes

#### Scenario: Discovery needs no credential
- **WHEN** the metadata document is fetched with no authentication
- **THEN** it is served
- **AND** it discloses nothing about the server's users, libraries, or contents

### Requirement: Authorizing an app with a code

An application SHALL begin authorization by requesting a user code, and the user
SHALL complete it in a browser on `app.hearthshelf.com`. The application SHALL
poll for completion and SHALL NOT receive tokens until the user has approved.

#### Scenario: Approving a connection
- **WHEN** the user enters a live code, chooses one or more of their servers, and
  approves
- **THEN** the application's next poll returns tokens scoped to exactly those
  servers

#### Scenario: The consent screen states the ask
- **WHEN** the user is shown the approval screen
- **THEN** it names the application, lists the scopes in plain language, and
  requires an explicit server selection

#### Scenario: The consent screen distinguishes a store app from an instance
- **WHEN** the user is shown the approval screen for a store-listed cloud app
- **THEN** it is shown as store-listed
- **WHEN** the app is an instance the user runs themselves
- **THEN** it is shown as their own instance

#### Scenario: Declining
- **WHEN** the user declines the request
- **THEN** the application's next poll reports the denial
- **AND** no authorization is recorded

#### Scenario: Polling before approval
- **WHEN** the application polls while the user has not yet acted
- **THEN** it is told the request is still pending

#### Scenario: Polling too fast
- **WHEN** the application polls faster than the interval it was given
- **THEN** it is told to slow down rather than being served

#### Scenario: An expired code
- **WHEN** the user enters a code that has expired or was already used
- **THEN** the attempt is refused and the application must start a fresh request

#### Scenario: Selecting no server
- **WHEN** the user approves without selecting any server
- **THEN** the approval is refused, because an authorization reaching nothing is
  a false confirmation of access

### Requirement: Authorizations are scoped and enforced at the server

An authorization SHALL be bound to a specific application, user, and set of
servers, and SHALL carry the scopes the user approved. A server SHALL enforce
those scopes on every request and SHALL reject a request exceeding them, whatever
the underlying account could otherwise do.

#### Scenario: Acting within scope
- **WHEN** an application holding `library:write` adds an item to a server it was
  authorized for
- **THEN** the request succeeds

#### Scenario: Exceeding granted scope
- **WHEN** an application holding only `library:read` attempts a write
- **THEN** the request is refused

#### Scenario: Reaching an unauthorized server
- **WHEN** an application presents a valid token to a server the user did not
  select
- **THEN** the request is refused

#### Scenario: Scope cannot exceed the user
- **WHEN** an application holds a scope broader than its authorizing user's own
  permissions on that server
- **THEN** the effective permission is the narrower of the two

### Requirement: Re-authorizing an existing connection

Authorizing an app the user has already connected SHALL update the existing
connection rather than accumulating duplicates.

#### Scenario: Connecting an app a second time
- **WHEN** a user authorizes an app they have already connected
- **THEN** the existing connection is updated to the newly chosen servers and
  scopes
- **AND** no second entry appears on the connections page

#### Scenario: An app asks for more than it was granted
- **WHEN** an already-connected app requests a scope the user did not previously
  grant
- **THEN** the user is asked to approve the additional scope explicitly
- **AND** the app keeps its existing access if they decline

### Requirement: Refresh tokens rotate

Exchanging a refresh token SHALL issue a new one and retire the old. A retired
refresh token SHALL NOT work.

#### Scenario: Rotating on exchange
- **WHEN** an application exchanges its refresh token
- **THEN** it receives a new refresh token
- **AND** the one it presented stops working

#### Scenario: A stolen refresh token is detected
- **WHEN** a retired refresh token is presented again
- **THEN** the exchange is refused
- **AND** the whole connection is revoked, because a replayed token means either
  the app or its stored credential is compromised

### Requirement: Users can see and revoke what is connected

A user SHALL be able to see every application connected to their account: which
servers it reaches, which scopes it holds, and when it last acted. They SHALL be
able to revoke an application entirely, or withdraw individual servers from it.

#### Scenario: Reviewing connections
- **WHEN** the user opens their connections page
- **THEN** each connected application is listed with its servers, scopes, and
  last-used time

#### Scenario: A server that cannot be reached
- **WHEN** the connections page cannot reach one of the user's servers
- **THEN** that server's applications are shown as unverified rather than
  presented as current

#### Scenario: Revoking an application
- **WHEN** the user revokes an application
- **THEN** its tokens stop working
- **AND** it disappears from the list

#### Scenario: Withdrawing one server
- **WHEN** the user removes a single server from an application that reaches
  several
- **THEN** the application keeps working against the remaining servers
- **AND** is refused against the withdrawn one

#### Scenario: Revocation takes effect immediately
- **WHEN** an application is revoked
- **THEN** its very next request to the server is refused
- **AND** it cannot obtain a new token

#### Scenario: Revoking while the control plane is unreachable
- **WHEN** a server administrator revokes an application from the server itself
  and the control plane cannot be reached
- **THEN** the revocation still takes effect

#### Scenario: A revoke that could not be delivered is not claimed
- **WHEN** the user revokes an application from the hosted app and its server
  cannot be reached
- **THEN** they are told the revocation did not take effect
- **AND** the application is not shown as revoked

#### Scenario: A server admin sees what reaches their server
- **WHEN** a server administrator opens Connected Apps on the box
- **THEN** the applications authorized against that server are listed with their
  scopes

### Requirement: An application needs no inbound reachability

An application SHALL be connectable without a public address, a port forward, or
any inbound route, and SHALL NOT be required to serve HTTP.

This is a floor, not a prohibition: an application MAY additionally offer a
same-machine loopback flow as a convenience. Such a flow SHALL be optional, and
SHALL NOT be the only way to connect.

#### Scenario: Connecting without serving anything
- **WHEN** an application that listens on no port at all connects
- **THEN** the connection succeeds

#### Scenario: A convenience flow never becomes a requirement
- **WHEN** an application offers a same-machine shortcut for connecting
- **THEN** a user whose browser is on a different machine can still connect

#### Scenario: Connecting from behind NAT
- **WHEN** an application running on a home network with no public address and no
  port forward connects
- **THEN** the connection succeeds

#### Scenario: Nothing connects back to the application
- **WHEN** an application is connected and in use
- **THEN** neither the control plane nor the server initiates a connection to it

### Requirement: An application can reach a server over the local network

An application SHALL be able to use a server reachable only on the local network.
Before presenting any credential to a private address, it SHALL verify the
server's identity.

#### Scenario: Using a server with no public address
- **WHEN** an application and a server are on the same local network, and the
  server has no public address
- **THEN** the application can connect to it and continue to use it

#### Scenario: Verifying before presenting a credential
- **WHEN** an application is about to present a credential to a private address
- **THEN** it first verifies the server's identity
- **AND** presents nothing if that verification fails

### Requirement: An established connection does not depend on the control plane

Once an application has been introduced to a server, its continued operation -
obtaining tokens, acting within scope, and being revoked - SHALL NOT require the
control plane. Only the initial introduction SHALL depend on it.

#### Scenario: Working with the control plane unreachable
- **WHEN** an application refreshes its token against a server it is already
  connected to, and the control plane cannot be reached
- **THEN** the refresh succeeds

#### Scenario: Connecting a new app still needs the introduction
- **WHEN** a user tries to authorize a NEW application while the control plane
  is unreachable
- **THEN** they are told the connection cannot be set up right now
- **AND** existing connections are unaffected

### Requirement: Applications are rate limited per server

A server SHALL limit how fast an application can call it, per application and
user, and SHALL refuse excess requests with a standard retry response rather than
degrading for everyone. Writes MAY be limited more tightly than reads.

#### Scenario: Exceeding the limit
- **WHEN** an application calls faster than its limit
- **THEN** it is refused with a rate-limit response telling it when to retry
- **AND** other applications and users are unaffected

#### Scenario: Throttling is visible to the user
- **WHEN** an application is being throttled persistently
- **THEN** the user can see that on the connections page, so they can revoke it

#### Scenario: A revoked app cannot consume the server
- **WHEN** a revoked application keeps retrying
- **THEN** it continues to be refused
- **AND** its retries are rate limited

### Requirement: Unlinking a server withdraws it from applications

Applications SHALL NOT retain access to a server through an authorization whose
underlying user link no longer exists.

#### Scenario: The user unlinks a server they had authorized apps against
- **WHEN** a user unlinks a server from their account
- **THEN** every application authorization naming that server for that user stops
  working

### Requirement: Connecting an app to a server is one step for the user

Once authorized, an application SHALL be able to configure itself against the
chosen server without the user supplying an address, credential, or library
identifier by hand.

#### Scenario: A destination configures itself
- **WHEN** the user authorizes an application that sends audiobooks to their
  server
- **THEN** the application resolves the server address and its own credential
  from the authorization
- **AND** the user is asked only for genuine choices, such as which library

#### Scenario: Authorization outlives a restart
- **WHEN** the application restarts
- **THEN** it continues to work without the user re-approving
