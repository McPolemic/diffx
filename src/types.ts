export type ReplyAuthor = 'reviewer' | 'agent'

export interface CommentReply {
  id: string
  body: string
  author: ReplyAuthor
  createdAt: number
}

export interface ReviewComment {
  id: string
  filePath: string
  side: 'deletions' | 'additions'
  lineNumber: number
  lineContent: string
  body: string
  status: 'open' | 'resolved'
  createdAt: number
  replies: CommentReply[]
}
