import { HOSTS } from '../../core/hosts'
import { defineModule, type ModuleOptions } from '../../core/module'
import type { CallOptions } from '../../core/transport'
import * as ops from './operations'
import type * as T from './types'

/** Options for the `mailbox` module. */
export type MailboxOptions = ModuleOptions

/**
 * Registers the mailbox module.
 * It handles mail the player received and mail the player sent.
 * The player must be logged in.
 * The server declares no business `outcome` codes for these APIs.
 *
 * @example
 * const r = await axyl.mailbox.getReceivedMails({ searchRequest: { size: 20 } })
 */
export function mailbox(options: MailboxOptions = {}) {
  return defineModule('mailbox', HOSTS.app, options, ({ call }) => ({
    /**
     * Gets the list of received mail.
     * The list is in `data`. The cursor for the next page is in `meta.page`.
     */
    getReceivedMails: (req: T.GetReceivedMailsRequest, o?: CallOptions) =>
      call(ops.getReceivedMails, req, o),
    /** Gets one received mail in the requested language. */
    getReceivedMail: (req: T.GetReceivedMailRequest, o?: CallOptions) =>
      call(ops.getReceivedMail, req, o),
    /**
     * Marks the body, the attachments, or both of a received mail as read.
     * Marking `ATTACHMENT` records only the read time. The game server grants the attachments.
     * Calling it again keeps the first read time.
     * A network failure does not tell whether the server recorded the read.
     * Get the mail again to check its state before you send the request again.
     */
    markMailAsRead: (req: T.MarkMailAsReadRequest, o?: CallOptions) =>
      call(ops.markMailAsRead, req, o),
    /** Deletes a received mail. */
    deleteReceivedMail: (req: T.DeleteReceivedMailRequest, o?: CallOptions) =>
      call(ops.deleteReceivedMail, req, o),
    /**
     * Sends a mail. The server processes it asynchronously.
     * A player can send only `DIRECT` mail.
     * The server sets the sender from the access token.
     * The mailbox does not grant attachments. The game server validates and grants them.
     *
     * `BROADCAST` mail is no longer supported. The server answers it with a `failure` whose code is `InvalidArgument` and whose `externalCode` is `invalid_parameter`.
     *
     * The SDK resends this POST only after a 429, or once after a 401 when the token refresh succeeds. Both use the same `Idempotency-Key`.
     * To send it again yourself when the result is unknown, create a key in the app and pass it as `idempotencyKey` on the first call and on the resend.
     * Without your own key, each call gets a new key, so the server cannot tell that the resend is a duplicate.
     * The server treats a request with the same key and the same body as a duplicate for 60 minutes.
     */
    sendMail: (req: T.SendMailRequest, o?: CallOptions) => call(ops.sendMail, req, o),
    /**
     * Revokes a sent mail. The server processes it asynchronously.
     * Only delivered mail that the recipient has not read is revoked.
     */
    revokeMail: (req: T.MailIdRequest, o?: CallOptions) => call(ops.revokeMail, req, o),
    /**
     * Gets the list of mail that the player sent.
     * The list is in `data`. The cursor for the next page is in `meta.page`.
     */
    getSentMails: (req: T.GetSentMailsRequest, o?: CallOptions) => call(ops.getSentMails, req, o),
    /** Gets one mail that the player sent. */
    getMail: (req: T.MailIdRequest, o?: CallOptions) => call(ops.getMail, req, o),
    /** Deletes a mail that the player sent. */
    deleteSentMail: (req: T.MailIdRequest, o?: CallOptions) => call(ops.deleteSentMail, req, o),
  }))
}

/** The API that the `mailbox` module adds to the client. */
export type MailboxModule = ReturnType<typeof mailbox>
export type * from './types'
