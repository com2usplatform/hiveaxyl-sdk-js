import { STANDARD_FAILURES } from '../../core/errors'
import { op } from '../../core/operation'
import type * as T from './types'

/** The server API spec that this module follows. */
export const SPEC = 'mailbox.openapi.yaml'

/*
 * Follows `mailbox.openapi.yaml`. It includes 9 of the 10 APIs.
 * The sender APIs accept a player token.
 * The server lets a player handle only the mail that the player sent.
 * `resendMail` is not included because the server does not provide it yet.
 * Only `sendMail` declares a business outcome.
 * The common errors are `STANDARD_FAILURES`.
 */

export const getReceivedMails = op<
  T.GetReceivedMailsRequest,
  T.GetReceivedMailsResponse,
  T.MailListMeta
>()({
  id: 'getReceivedMails',
  method: 'GET',
  path: '/mailbox/v1/mails/received',
  credential: 'session',
  ids: { response: ['[].recipientPlayerId'] },
  params: { query: ['searchRequest'] },
  outcomes: [],
  failures: STANDARD_FAILURES,
})

export const getReceivedMail = op<T.GetReceivedMailRequest, T.GetReceivedMailResponse>()({
  id: 'getReceivedMail',
  method: 'GET',
  path: '/mailbox/v1/mails/received/{mailRecipientId}',
  credential: 'session',
  ids: { response: ['recipientPlayerId', 'mail.recipientPlayerIds[]'] },
  params: { path: ['mailRecipientId'], query: ['language'], requiredQuery: ['language'] },
  outcomes: [],
  failures: STANDARD_FAILURES,
})

export const markMailAsRead = op<T.MarkMailAsReadRequest, T.MarkMailAsReadResponse>()({
  id: 'markMailAsRead',
  method: 'POST',
  path: '/mailbox/v1/mails/received/{mailRecipientId}/mark-as-read',
  credential: 'session',
  params: { path: ['mailRecipientId'], body: 'body' },
  outcomes: [],
  failures: STANDARD_FAILURES,
})

export const deleteReceivedMail = op<T.DeleteReceivedMailRequest, T.DeleteReceivedMailResponse>()({
  id: 'deleteReceivedMail',
  method: 'DELETE',
  path: '/mailbox/v1/mails/received/{mailRecipientId}',
  credential: 'session',
  params: { path: ['mailRecipientId'] },
  outcomes: [],
  failures: STANDARD_FAILURES,
})

/**
 * The spec declares `Idempotency-Key` for this API. The SDK sends one new key per call unless the app passes `idempotencyKey`.
 * The header does not make the POST idempotent, so a 5xx or a connection error is not retried.
 */
export const sendMail = op<T.SendMailRequest, T.MailAccepted>()({
  id: 'sendMail',
  method: 'POST',
  path: '/mailbox/v1/mail/send',
  credential: 'session',
  ids: { request: ['recipientPlayerIds[]'] },
  params: { body: 'body' },
  idempotencyKey: true,
  outcomes: [],
  failures: STANDARD_FAILURES,
})

export const revokeMail = op<T.MailIdRequest, T.MailAccepted>()({
  id: 'revokeMail',
  method: 'POST',
  path: '/mailbox/v1/mails/sent/{mailId}/revoke',
  credential: 'session',
  params: { path: ['mailId'] },
  outcomes: [],
  failures: STANDARD_FAILURES,
})

export const getSentMails = op<T.GetSentMailsRequest, T.GetSentMailsResponse, T.MailListMeta>()({
  id: 'getSentMails',
  method: 'GET',
  path: '/mailbox/v1/mails/sent',
  credential: 'session',
  ids: { response: ['[].firstRecipientPlayerId'] },
  params: { query: ['searchRequest'] },
  outcomes: [],
  failures: STANDARD_FAILURES,
})

export const getMail = op<T.MailIdRequest, T.GetMailResponse>()({
  id: 'getMail',
  method: 'GET',
  path: '/mailbox/v1/mails/sent/{mailId}',
  credential: 'session',
  ids: { response: ['recipientPlayerIds[]'] },
  params: { path: ['mailId'] },
  outcomes: [],
  failures: STANDARD_FAILURES,
})

export const deleteSentMail = op<T.MailIdRequest, T.DeleteSentMailResponse>()({
  id: 'deleteSentMail',
  method: 'DELETE',
  path: '/mailbox/v1/mails/sent/{mailId}',
  credential: 'session',
  params: { path: ['mailId'] },
  outcomes: [],
  failures: STANDARD_FAILURES,
})
