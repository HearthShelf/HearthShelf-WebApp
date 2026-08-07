## Purpose

The listening history screen, and the corrections a listener can make to it -
removing a session they did not actually listen to, or fixing one that recorded
the wrong amount of time.

## ADDED Requirements

### Requirement: Correcting a session

A session row SHALL offer a way to delete the session, and a way to correct the
listening time it recorded.

#### Scenario: Opening the row actions
- **WHEN** the user opens a session row's actions
- **THEN** Delete session and Edit duration are offered

#### Scenario: Deleting a session
- **WHEN** the user confirms Delete session
- **THEN** the session is removed on the server
- **AND** the row leaves the list
- **AND** the screen's derived totals no longer count it

#### Scenario: Correcting a duration
- **WHEN** the user sets a session's duration to a new value and confirms
- **THEN** the session is updated in place rather than duplicated
- **AND** the row shows the corrected duration

#### Scenario: Abandoning an edit
- **WHEN** the user opens either action and cancels
- **THEN** nothing is sent and the row is unchanged

### Requirement: Both actions confirm first

Deleting or editing a session SHALL require an explicit confirmation. Neither
SHALL run on a single tap of a row or menu item.

#### Scenario: Delete asks first
- **WHEN** the user chooses Delete session
- **THEN** a confirmation naming the book and the session's date is shown
- **AND** the session is deleted only after the user confirms

### Requirement: Permission and failure handling

Session deletion depends on the account's delete permission on the server, so
the screen SHALL NOT assume it will succeed.

#### Scenario: Account lacks delete permission
- **WHEN** the account does not have the server's delete permission
- **THEN** the delete action is not offered

#### Scenario: The server refuses the delete
- **WHEN** a delete is attempted and the server rejects it
- **THEN** the row stays in the list
- **AND** the user is told the session could not be deleted

#### Scenario: The write fails after an optimistic update
- **WHEN** the list has already updated locally and the server write then fails
- **THEN** the list returns to its previous state
- **AND** the failure is surfaced rather than silently swallowed

### Requirement: Totals stay consistent with the list

The screen's derived summary figures SHALL reflect the sessions currently in the
list, so a correction is visible immediately rather than after a reload.

#### Scenario: Totals after a delete
- **WHEN** a session is deleted
- **THEN** the summary figures recompute without that session

#### Scenario: Totals after an edit
- **WHEN** a session's duration is corrected
- **THEN** the summary figures recompute using the new duration

### Requirement: Consistent across both web apps

The hosted and self-hosted apps SHALL offer the same actions with the same
wording and the same confirmation behaviour, differing only in how each reaches
the server.

#### Scenario: Same behaviour on either app
- **WHEN** a listener uses the history screen on either app
- **THEN** the available actions, their labels, and their confirmations match
