/**
 * Keep previously deployed namespaces addressable after the application rollback.
 * These classes are intentionally unbound: the reverted API has no comments routes.
 * Removing their exports or rewriting migration history prevents redeployment.
 * Do not delete their stored data while retaining this compatibility layer.
 */
export class ShowroomComments {
  async fetch() {
    return Response.json({message: 'Comments relay is not enabled in this API version'}, {
      status: 503,
      headers: {'Cache-Control': 'private, no-store'},
    });
  }
  // A pending alarm from the old implementation must leave storage intact.
  async alarm() {}
}

export class IdnComments extends ShowroomComments {}
