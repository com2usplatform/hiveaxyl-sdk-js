import type { OpenEnum } from '../../core/operation'

/*
 * Types follow `mailbox.openapi.yaml`.
 * A response type describes the content of the response `data` field.
 * Times are UTC strings.
 */

/** Language code of a mail. */
export type MailLanguage =
  | 'ko'
  | 'en'
  | 'ja'
  | 'zh-Hans'
  | 'zh-Hant'
  | 'de'
  | 'fr'
  | 'ru'
  | 'it'
  | 'es'
  | 'pt'
  | 'pl'
  | 'nl'
  | 'tr'
  | 'th'
  | 'id'
  | 'ar'
  | 'hi'
  | 'vi'
  | 'sv'
  | 'cs'
  | 'fa'
  | 'no'
  | 'uk'
  | 'ro'
  | 'he'
  | 'ms'
  | 'da'
  | 'el'
  | 'hu'
  | 'tl'

/** Mail content type. `TEXT` is a text mail. `ATTACHMENT` is a mail with attachments. */
export type MailContentType = 'TEXT' | 'ATTACHMENT'
/** Sender type. */
export type SenderType = 'ADMIN' | 'HIVE_SYSTEM' | 'PROJECT_SYSTEM' | 'USER'

/**
 * Search conditions for received mail.
 * Each field becomes its own query parameter (OpenAPI `form` style with `explode`).
 * Omit a field to leave that condition unapplied.
 */
export interface ReceivedMailSearch {
  /** Language of the title and body. The mail's default language is used when no translation exists. */
  readonly language?: MailLanguage
  /** Mailbox category to filter by. */
  readonly mailCategory?: string
  /** Content type to filter by. */
  readonly mailContentType?: MailContentType
  /** `true` returns only mail whose body was read. `false` returns only mail whose body was not read. */
  readonly textRead?: boolean
  /** `true` returns only mail whose attachments were read. `false` returns only the others. */
  readonly attachmentRead?: boolean
  /**
   * Cursor where the page starts. Omit it for the first page, which holds the newest mail.
   * With `NEXT`, pass `nextCursor` from the previous page.
   * With `PREVIOUS`, pass the `mailRecipientId` of the first mail on the current page,
   * or `previousCursor` from the previous `PREVIOUS` page. A `NEXT` page has no `previousCursor`.
   */
  readonly cursor?: string
  /**
   * Direction to read from the cursor. `NEXT`, the default, reads older mail. `PREVIOUS` reads newer mail,
   * for example to go back a page or to refresh. The list is newest first in both directions.
   * In `meta.page`, only the fields for the direction of the answer are meaningful:
   * `hasNext` and `nextCursor` for `NEXT`, `hasPrevious` and `previousCursor` for `PREVIOUS`.
   * Without `cursor`, both directions return the first page and answer as `NEXT` does.
   * A `PREVIOUS` page holds at most `size` mails. To catch up on newer mail, repeat it until `hasPrevious` is `false`.
   */
  readonly direction?: 'PREVIOUS' | 'NEXT'
  /** Page size. The server default applies when omitted. */
  readonly size?: number
}

/** Request for `getReceivedMails`. */
export interface GetReceivedMailsRequest {
  /** Search conditions. */
  readonly searchRequest: ReceivedMailSearch
}

/** One item in the received mail list. */
export interface ReceivedMailSummary {
  /** Received mail ID. Use it to get, mark, or delete this received mail. */
  readonly mailRecipientId?: string
  /** Mail ID. */
  readonly mailId?: string
  /** Recipient player ID. */
  readonly recipientPlayerId?: string
  /** Time the mail arrived in the mailbox. It differs per recipient. */
  readonly deliveredAt?: string
  /** Time the body was marked as read. `null` if not read. */
  readonly textReadAt?: string | null
  /** Time the attachments were marked as read. `null` if not read. */
  readonly attachmentReadAt?: string | null
  /** Time the mail expires. */
  readonly expiresAt?: string
  /** Mailbox category. */
  readonly mailCategory?: string
  /** Content type. */
  readonly mailContentType?: OpenEnum<MailContentType>
  /** Mail title. */
  readonly title?: string
  /** Sender ID. */
  readonly senderId?: string
  /** Sender type. */
  readonly senderType?: OpenEnum<SenderType>
  /** Sender name shown to the player, as it was at send time. */
  readonly senderDisplayName?: string
}

/** Response for `getReceivedMails`. The list is in `data`. The cursor for the next page is in `meta.page`. */
export type GetReceivedMailsResponse = readonly ReceivedMailSummary[]

/** Request for `getReceivedMail`. */
export interface GetReceivedMailRequest {
  /** Received mail ID. */
  readonly mailRecipientId: string
  /** Language of the title and body. */
  readonly language: MailLanguage
}

/** An attachment of a mail. The game server grants it. */
export interface MailAttachment {
  /** Mail ID. */
  readonly mailId?: string
  /** Quantity to grant. */
  readonly quantity?: number
  /** Attachment type that the game defines, such as an item, a coupon, or currency. */
  readonly attachmentType?: string
  /** ID of the game content. */
  readonly referenceId?: string
  /** Creation time. */
  readonly createdAt?: string
}

/** Response for `getReceivedMail`. */
export interface GetReceivedMailResponse {
  /** Received mail ID. */
  readonly mailRecipientId?: string
  /** The mail. */
  readonly mail?: {
    /** Mail ID. */
    readonly mailId?: string
    /** Mailbox category that the game defines. */
    readonly mailCategory?: string
    /** Content type. */
    readonly mailContentType?: OpenEnum<MailContentType>
    /** Sender type. */
    readonly senderType?: OpenEnum<SenderType>
    /** Sender ID. */
    readonly senderId?: string
    /** Sender name shown to the player, as it was at send time. */
    readonly senderDisplayName?: string
    /** Recipient scope. */
    readonly recipientScope?: OpenEnum<'BROADCAST' | 'DIRECT'>
    /** Recipient player IDs. `null` for `BROADCAST` mail. */
    readonly recipientPlayerIds?: readonly string[] | null
    /** Mail title. */
    readonly title?: string
    /** Mail body. */
    readonly body?: string
    /** Default language of the mail. */
    readonly language?: OpenEnum<MailLanguage>
    /** Mail data that the game defines, such as display or claim conditions. The server does not interpret it. */
    readonly mailExtension?: string | null
    /** Time the mail expires. */
    readonly expiresAt?: string
    /** Mail status. */
    readonly mailStatus?: OpenEnum<'ACTIVE' | 'REVOKED' | 'EXPIRED'>
    /** Time the status changed to `EXPIRED` or `REVOKED`. `null` while `ACTIVE`. */
    readonly closedAt?: string | null
    /** Creation time. */
    readonly createdAt?: string
    /** Time delivery to every recipient finished. `null` until then. */
    readonly dispatchedAt?: string | null
    /** Attachments. */
    readonly attachments?: readonly MailAttachment[] | null
  }
  /** Recipient player ID. */
  readonly recipientPlayerId?: string
  /** Time the mail arrived in the mailbox. */
  readonly deliveredAt?: string
  /** Time the body was marked as read. `null` if not read. */
  readonly textReadAt?: string | null
  /** Time the attachments were marked as read. `null` if not read. */
  readonly attachmentReadAt?: string | null
  /** Time the mail expires. */
  readonly expiresAt?: string
}

/** Request for `markMailAsRead`. */
export interface MarkMailAsReadRequest {
  /** Received mail ID. */
  readonly mailRecipientId: string
  readonly body: {
    /** What to mark as read: the body, the attachments, or both. */
    readonly target: 'TEXT' | 'ATTACHMENT' | 'ALL'
  }
}

/** Response for `markMailAsRead`. */
export interface MarkMailAsReadResponse {
  /** Received mail ID. */
  readonly mailRecipientId?: string
  /** Time the body was marked as read. `null` if not read. */
  readonly textReadAt?: string | null
  /** Time the attachments were marked as read. `null` if not read. */
  readonly attachmentReadAt?: string | null
}

/** Request for `deleteReceivedMail`. */
export interface DeleteReceivedMailRequest {
  /** Received mail ID. */
  readonly mailRecipientId: string
}

/** Response for `deleteReceivedMail`. */
export interface DeleteReceivedMailResponse {
  /** Received mail ID. */
  readonly mailRecipientId?: string
  /** Mail ID. */
  readonly mailId?: string
  /** Time the server deleted the mail. */
  readonly deletedAt?: string
}

/** Request for `sendMail`. A player handles only the mail that the player sent. */
export interface SendMailRequest {
  readonly body: {
    /** Mailbox category that the game defines. */
    readonly mailCategory?: string
    /** Sender name shown to the recipient. It is stored as it is at send time. */
    readonly senderDisplayName: string
    /** Send `DIRECT`. `BROADCAST` is no longer supported and returns a `failure` with `InvalidArgument`. */
    readonly recipientScope: 'BROADCAST' | 'DIRECT'
    /** Recipient player IDs. Required for `DIRECT`. */
    readonly recipientPlayerIds?: readonly string[]
    /** Content type. Use `ATTACHMENT` to send `attachments`. */
    readonly mailContentType: MailContentType
    /** Mail title. */
    readonly title: string
    /** Mail body. */
    readonly body: string
    /** Language of the title and body. It becomes the mail's default language. */
    readonly language: MailLanguage
    /** Mail data that the game defines, such as display or claim conditions. The server does not interpret it. */
    readonly mailExtension?: string
    /** Time the mail expires. It must be within 30 days from now. */
    readonly expiresAt: string
    /** Attachments. The mailbox does not grant them. The game server validates and grants them. */
    readonly attachments?: readonly {
      /** Attachment type that the game defines, such as an item, a coupon, or currency. */
      readonly attachmentType?: string
      /** ID of the game content. */
      readonly referenceId: string
      /** Quantity to grant. */
      readonly quantity: number
    }[]
  }
}

/** Response for `sendMail` and `revokeMail`. The server processes the request asynchronously. */
export interface MailAccepted {
  /** Mail ID. */
  readonly mailId?: string
  /** Time the server accepted the request. */
  readonly acceptedAt?: string
}

/** Request for `revokeMail`, `getMail`, and `deleteSentMail`. */
export interface MailIdRequest {
  /** Mail ID. */
  readonly mailId: string
}

/** Search conditions for sent mail. Omit a field to leave that condition unapplied. */
export interface SentMailSearch {
  /** Mailbox category to filter by. */
  readonly mailCategory?: string
  /** Content type to filter by. */
  readonly mailContentType?: MailContentType
  /** Mail status to filter by. */
  readonly mailStatus?: 'ACTIVE' | 'REVOKED' | 'EXPIRED'
  /** Cursor where the page starts. Pass `nextCursor` from the previous page. Omit it for the first page. */
  readonly cursor?: string
  /** Page size. The server default applies when omitted. */
  readonly size?: number
}

/** Request for `getSentMails`. */
export interface GetSentMailsRequest {
  /** Search conditions. */
  readonly searchRequest: SentMailSearch
}

/** One item in the sent mail list. */
export interface SentMailSummary {
  /** Mail ID. */
  readonly mailId?: string
  /** Sender ID. */
  readonly senderId?: string
  /** Sender name shown to the recipient, as it was at send time. */
  readonly senderDisplayName?: string
  /** Mailbox category. */
  readonly mailCategory?: string
  /** Content type. */
  readonly mailContentType?: OpenEnum<MailContentType>
  /** Mail title. */
  readonly title?: string
  /** Mail status. */
  readonly mailStatus?: OpenEnum<'ACTIVE' | 'REVOKED' | 'EXPIRED'>
  /** Time the status changed to `EXPIRED` or `REVOKED`. `null` while `ACTIVE`. */
  readonly closedAt?: string | null
  /** Time the mail expires. */
  readonly expiresAt?: string
  /** Time the mail was sent. */
  readonly createdAt?: string
  /** Time delivery to every recipient finished. `null` until then. */
  readonly dispatchedAt?: string | null
  /** First player ID in the recipient list. `null` for mail sent to everyone. Use `getMail` for the full list. */
  readonly firstRecipientPlayerId?: string | null
  /** Number of recipients. */
  readonly recipientCount?: number | null
}

/** Response for `getSentMails`. The list is in `data`. The cursor for the next page is in `meta.page`. */
export type GetSentMailsResponse = readonly SentMailSummary[]

/** Response for `getMail`. */
export type GetMailResponse = NonNullable<GetReceivedMailResponse['mail']>

/** Response for `deleteSentMail`. */
export interface DeleteSentMailResponse {
  /** Mail ID. */
  readonly mailId?: string
  /** Time the server deleted the mail. */
  readonly deletedAt?: string
}

/** The `meta` of a mail list response. Pass `nextCursor` as `cursor` to get the next page. */
export interface MailListMeta {
  readonly page?: {
    /** Cursor for the next page. */
    readonly nextCursor?: string | null
    /** Whether a next page exists. */
    readonly hasNext?: boolean
    /** Cursor for the previous page. */
    readonly previousCursor?: string | null
    /** Whether a previous page exists. `null` for APIs that do not page in both directions. */
    readonly hasPrevious?: boolean | null
  }
}
