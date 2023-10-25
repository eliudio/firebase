// ***************************************************************************************************
// ***************************************** eliud_core **********************************************
// ***************************************************************************************************

'use strict';

const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp(functions.config().firebase);

const firestore = admin.firestore();
const settings = { timestampInSnapshots: true };
firestore.settings(settings)

const increment = admin.firestore.FieldValue.increment(1);
const decrement = admin.firestore.FieldValue.increment(-1);

const {Storage} = require('@google-cloud/storage');

const bucket = functions.config().app.bucket;
const storage = new Storage();
const myBucket = storage.bucket(bucket);

const { MailtrapClient } = require("mailtrap");

//const sgMail = require('@sendgrid/mail');
//sgMail.setApiKey(functions.config().sendgrid.apikey);

// member

async function updateMemberAndPublicInfo(data, context) {
  functions.logger.log('updateMemberAndPublicInfo');
  const documentId = context.params.documentId;
  var memberPublicInfoDoc = admin.firestore().collection('memberpublicinfo')
      .doc(context.params.documentId);
  const val = data;
 
  if (!((val.subscriptions === undefined) || (val.subscriptions == null) || (val.subscriptions.length === 0))) {
    functions.logger.log(val.subscriptions);
    const subscriptionsAsString = val.subscriptions.map(value => value.appId);
    await admin.firestore().collection('member').doc(documentId).update({'subscriptionsAsStrArr': subscriptionsAsString});

    var memberPublicData = {
      name: val.name,
      subscriptions: val.subscriptions,
      subscriptionsAsStrArr: subscriptionsAsString,
      photoURL: val.photoURL
    }
    return memberPublicInfoDoc.set(memberPublicData);
  } else {
    await admin.firestore().collection('member').doc(documentId).update({'subscriptionsAsStrArr': []});
    var memberPublicData = {
      name: val.name,
      subscriptions: [],
      subscriptionsAsStrArr: [],
      photoURL: val.photoURL
    }
    return memberPublicInfoDoc.set(memberPublicData);
  }
}

exports.memberSyncUpdate = functions.firestore.document('member/{documentId}').onUpdate(async (snap, context) => {
  functions.logger.log('member onUpdate');
  const afterSnapshot = snap.after;
  if (afterSnapshot != null) {
    const afterVal = afterSnapshot.data();
    return updateMemberAndPublicInfo(afterVal, context);
  } else {
    functions.logger.log('afterSnapshot was null');
  }
});

exports.memberSyncDelete = functions.firestore.document('member/{documentId}').onDelete(async (snap, context) => {
  functions.logger.log('member onDelete');
  var memberPublicInfoDocRef = admin.firestore().collection('memberpublicinfo')
      .doc(context.params.documentId);
  if (memberPublicInfoDocRef != null) {
    return memberPublicInfoDocRef.delete();
  } else {
    functions.logger.log('could not find the document that was deleted');
  }
});

exports.memberSyncCreate = functions.firestore.document('member/{documentId}').onCreate(async (snap, context) => {
  functions.logger.log('member onCreate');
  return updateMemberAndPublicInfo(snap.data(), context);
});

// *************************************************************************************************************
// ********************************************** access > claims **********************************************
// *************************************************************************************************************

function arrayRemove(arr, value) { 
  if (arr === undefined) {
    return [];
  } else {
    return arr.filter(function(element){ 
      return element != value; 
    });
  }
}


function updateToken(afterVal, memberId, context) {
  if (afterVal != null) {
    functions.logger.log('afterval is: ');
    functions.logger.log(afterVal);
    var privilegeLevel = afterVal.privilegeLevel;
    var appId = afterVal.appId;
    
    return admin.auth().getUser(memberId).then((user) => {
      // Change custom claim without overwriting existing claims.
      var claims = user.customClaims;
      functions.logger.log('claimes before: ');
      functions.logger.log(claims);
      var level1;
      var level2;
      var level3;
      if (claims === undefined) {
        if (privilegeLevel == 1) {
          claims = {
            level1: [appId],
            level2: [],
            level3: [],
          };
        } else if (privilegeLevel == 2) {
          claims = {
            level1: [],
            level2: [appId],
            level3: [],
          };
        } else if (privilegeLevel == 3) {
          claims = {
            level1: [],
            level2: [],
            level3: [appId],
          };
        } else {
          claims = {
            level1: [],
            level2: [],
            level3: [],
          };
        }

        functions.logger.log('creating user claims for ' + memberId + ', setting it to : ');
        functions.logger.log(claims);
        // now set the privilegeLevel token for this app for this member. Existing claims will not be overwritten.
        return updateClaim(memberId, claims);
      } else {
        level1 = claims.level1;
        level2 = claims.level2;
        level3 = claims.level3;

        // remove the current app from the level
        level1 = arrayRemove(level1, appId);
        level2 = arrayRemove(level2, appId);
        level3 = arrayRemove(level3, appId);
        
        functions.logger.log('Claims after removing the current claim for appId ' + appId);
        functions.logger.log(claims);

        functions.logger.log('privilegeLevel = ' + privilegeLevel);
        // add the current app to the correct level
        if (privilegeLevel == 1) {
          level1.push(appId);
        }
        if (privilegeLevel == 2) {
          level2.push(appId);
        }
        if (privilegeLevel == 3) {
          level3.push(appId);
        }
        
        claims.level1 = level1;
        claims.level2 = level2;
        claims.level3 = level3;

        functions.logger.log('updating user claims for ' + memberId + ', setting it to : ');
        functions.logger.log(claims);
        // now set the privilegeLevel token for this app for this member. Existing claims will not be overwritten.
        return updateClaim(memberId, claims);
      }
    });
  } else {
    functions.logger.log('afterVal was null');
  }
  return null;
}

async function updateClaim(memberId, claims) {
  await admin.firestore().collection('memberclaim').doc(memberId).update({'refreshValue': increment});
  return admin.auth().setCustomUserClaims(memberId, claims);
}  

// Synchronse custom auth token with access data
exports.accessSyncUpdate = functions.firestore.document('app/{appId}/access/{documentId}').onUpdate(async (snap, context) => {
  functions.logger.log('updating access');
  const afterSnapshot = snap.after;
  if (afterSnapshot != null) {
    var memberId = context.params.documentId;
    const afterVal = afterSnapshot.data();
    return updateToken(afterVal, memberId, context);
  } else {
    functions.logger.log('afterSnapshot was null');
  }
  return null;
});

exports.accessSyncDelete = functions.firestore.document('app/{appId}/access/{documentId}').onDelete(async (snap, context) => {
  functions.logger.log('delete access');
  const val = snap.data();
  var memberId = context.params.documentId;
  val.privilegeLevel = 0;
  return updateToken(val, memberId, context);
});

exports.accessSyncCreate = functions.firestore.document('app/{appId}/access/{documentId}').onCreate(async (snap, context) => {
  functions.logger.log('create access');
  const snapshot = snap.data();

  const appId = snapshot.appId;
  if (appId != null) {
    functions.logger.log('appId: ' + appId);
    var appRef = admin.firestore().collection('app').doc(appId);
    if (appRef != null) {
      functions.logger.log('appRef is not null');
      const appDoc = await appRef.get();
      if (appDoc.exists) {
        var appData = appDoc.data();
        functions.logger.log('appData.autoPrivileged1 = ' + appData.autoPrivileged1);
        if ((appData.autoPrivileged1 != null) && (appData.autoPrivileged1)) {
          functions.logger.log('auto privilegeLevel is on!');
          await snap.ref.update({ 'privilegeLevel': 1 });
        } else {
          functions.logger.log('auto privilegeLevel is off');
        }
      } else {
        functions.logger.log('impossible: app does not exist (' + appId + ')');
      }
    }
  }

  var memberId = context.params.documentId;
  return updateToken(snapshot, memberId, context);
});

// readAccess 
// Update readAccess (list of members) based on the fields "accessibleByGroup" and "accessibleByMembers"  
// in 1) memberMedium, 2) post, 3) chat, 4) chatMemberInfo, 5) memberProfile  

async function findFollowers(appId, followedId) {
  var appRef = admin.firestore().collection('app').doc(appId);
  if (appRef != null) {
    functions.logger.log('Searching followingArray with id = ' + followedId);
    var followingArrayRef = appRef.collection('followingarray').doc(followedId);
    if (followingArrayRef != null) {
      const followingArrayDoc = await followingArrayRef.get();
      if (followingArrayDoc.exists) {
        functions.logger.log('followingArrayDoc.exists');
        var followingArrayData = followingArrayDoc.data();
        var followers = followingArrayData.followers;
        functions.logger.log('followers:');
        functions.logger.log(followers);
        return followers;
      } else {
        functions.logger.log('!followingArrayDoc.exists');
      }
    } else {
      functions.logger.log('!followingArrayRef == null');
    }
  } else {
    functions.logger.log('appp document for ' + appId + ' does not exist');
  }
  return [];
}

async function updateMemberMediumFile(filePath, owner, accessibleByGroup, readAccess) {
  const myFile = myBucket.file(filePath);
  
  functions.logger.log('Updating metadata for file:');
  functions.logger.log(filePath);
  const newMetadata = {
        metadata: {
          owner: owner,
          readAccess: readAccess.join(';'),
          accessibleByGroup: accessibleByGroup
        }
  }

  functions.logger.log('Meta data:');
  functions.logger.log(newMetadata);
  return myFile.setMetadata(newMetadata)
    .then((metadata) => {
      functions.logger.log('Updated meta data');
    }).catch((error) => {
      functions.logger.log('error whilst updating metaData ' + error);
    });
}

// 1) memberMedium
async function updateReadAccessMemberMedium(memberMedium, documentId) {
  if (memberMedium != null) {
    const appId = memberMedium.appId;
    var appRef = admin.firestore().collection('app').doc(appId);
    var memberMediumRef = appRef.collection('membermedium').doc(documentId);
    if (memberMedium.authorId == null) {
      functions.logger.log('author is null for memberMedium ' + documentId);
    } else {
      var readAccess;
      if (memberMedium.accessibleByGroup == 0) {

        // PUBLIC
        readAccess = ['PUBLIC', memberMedium.authorId];

      } else if (memberMedium.accessibleByGroup == 1) {

        // FOLLOWERS
        readAccess = await findFollowers(appId, memberMedium.authorId);
        readAccess.push(memberMedium.authorId);

      } else if (memberMedium.accessibleByGroup == 2) {

        // ME
        readAccess = [ memberMedium.authorId ];

      } else if (memberMedium.accessibleByGroup == 3) {

        // SPECIFIC MEMBERS
        if ((memberMedium.accessibleByMembers === undefined) || (memberMedium.accessibleByMembers == null)) {

          functions.logger.log('accessibleByMembers == null');
          readAccess = [ memberMedium.authorId ];

        } else {

          functions.logger.log('accessibleByMembers != null');
          readAccess = memberMedium.accessibleByMembers;
          readAccess.push(memberMedium.authorId);
          functions.logger.log('readAccess:');
          functions.logger.log(readAccess);

        }

      } else {
        functions.logger.error('memberMedium.accessibleByGroup has unexpected value ' + memberMedium.accessibleByGroup);
        return;
      }

      await updateMemberMediumFile(memberMedium.ref, memberMedium.authorId, memberMedium.accessibleByGroup, readAccess);
      await updateMemberMediumFile(memberMedium.refThumbnail, memberMedium.authorId, memberMedium.accessibleByGroup, readAccess);
      return memberMediumRef.update({ 'readAccess': readAccess });
    }
  } else {
    functions.logger.log('memberMedium was null');
  }
}

// readAccess triggers
// 1) memberMedium
exports.memberMediumSyncUpdate = functions.firestore.document('/app/{appid}/membermedium/{documentId}').onWrite(async (snap, context) => {
  functions.logger.log('memberMediumSyncUpdate');
  
  const afterSnapshot = snap.after;
  if (afterSnapshot != null) {
    const memberMedium = afterSnapshot.data();
    const documentId = context.params.documentId;
    return updateReadAccessMemberMedium(memberMedium, documentId);
  } else {
    functions.logger.log('afterSnapshot was null');
  }
});

exports.memberMediumSyncDelete = functions.firestore.document('/app/{appid}/membermedium/{documentId}').onDelete(async (snap, context) => {
  functions.logger.log('memberMediumSyncDelete');
  // delete the file
});

// mail 
//const sgmailEmail = functions.config().sendgrid.email;

const TOKEN = functions.config().mailtrap.token;
const ENDPOINT = "https://send.api.mailtrap.io/";

const client = new MailtrapClient({ endpoint: ENDPOINT, token: TOKEN });

const appName = functions.config().app.appname;
const collectionName = functions.config().app.collectionname;


// Sends a welcome email to the given user.
async function sendEmail(email, theSubject, theText) {
  console.log("sendEmail");

  const sender = {
    email: functions.config().mailtrap.sender.email, // "mailtrap@thoma5.com"
    name: functions.config().mailtrap.sender.name    // "Mailtrap Test",
  };
  const recipients = [
    {
      email: email,
    }
  ];

  client
    .send({
      from: sender,
      to: recipients,
      subject: theSubject,
      text: theText,
      category: theSubject,
    })
    .then(console.log, console.error);


/*  sgMail
  .send(msg)
  .then((response) => {
    console.log("Email sent to " + email + " " + " with subject " + theSubject);
  })
  .catch((error) => {
    console.log("Error sending mail...");
    console.error(error);
  });
  */
}

// Sends a welcome email to new user.
exports.sendWelcomeEmail = functions.auth.user().onCreate((user) => {
  console.log("sendWelcomeEmail");
  const email = user.email; // The email of the user.
  const displayName = user.displayName; // The display name of the user.
  
  return sendEmail(email, 'Welcome ' + displayName, 'Hello ' + displayName + '. Welcome new joiner');
});

// dumpMemberData

async function retrieveCollectionData(appRef, collection, uid, myProcessData) {
  if (collection != null) {
    if ((collection.name != null) && (collection.memberIdentifier != null)) {
      await myProcessData.startCollection(collection.name);
      if (uid != 'documentID') {
        var querySnapshot = await appRef.collection(collection.name).where(collection.memberIdentifier, '==', uid).get();
        await querySnapshot.forEach(async (doc) => {
          await myProcessData.processData(doc.id, doc);
        });
      } else {
        var documentRef = appRef.collection(collection.name).doc(uid);
        if (documentRef != null) {
          const doc = await documentRef.get();
          await myProcessData.processData(doc.id, doc);
        }
        
        await appRef.collection(collection.name);
      }
      await myProcessData.endCollection(collection.name);
    } else {
      functions.logger.log('collection.name is null or collection.memberIdentifier is null');
    }
  } else {
    functions.logger.log('collection is null');
  }
}

async function retrieveData(appId, uid, collections, myProcessData) {
  var appRef = await admin.firestore().collection('app').doc(appId);
  if (appRef != null) {
    for (var collection of collections) {
      await retrieveCollectionData(appRef, collection, uid, myProcessData)
    }
    return true;
  } else {
    functions.logger.log('appRef is null');
    return false;
  }
}

async function processData(data, myProcessData) {
  if (data != null) {
    var appId = data.appId;
    var authorId = data.authorId;
    var collections = data.collections;
    if (collections != null) {
      if (authorId != null) {
        return await retrieveData(appId, authorId, collections, myProcessData);
      } else {
        functions.logger.log('authorId is null');
      }
    } else {
      functions.logger.log('collections is null');
    }
  } else {
    functions.logger.log('data is null');
  }
  return false;
}

exports.backendrequestCreate = functions.firestore.document('app/{appId}/backendrequest/{documentId}').onCreate(async (snap, context) => {
  if (snap != null) {
    functions.logger.log('backendrequestCreate');
    const data = snap.data();
    
    await snap.ref.update({ 'processed': true });
    
    // RequestType.RequestEmailData
    if (data.requestType == 0) {
      class GenerateHtml {
        constructor() {
          this.htmlValue = '<p>Hi</p><p><p>Below is the data that we keep. When opening URLs, make sure to login to the (google?) account to have access to the links / images.</p>';
        }
        
        async startCollection(name) {
          var value = '<p><b>Collection: ' + name + '</b></p>';
          this.htmlValue = this.htmlValue + value;
        }

        async processData(id, doc) {
          var data = JSON.stringify(doc.data(), null, 2);
          var value = '<p><b>Document ID:' + id + "</b></p><code>" + data + '</code>';
          this.htmlValue = this.htmlValue + value;
        }

        async endCollection(name) {
          this.htmlValue = this.htmlValue + '<hr>';
        }
      }

      var generateHtml = new GenerateHtml();
      if (await processData(data, generateHtml)) {
        return sendEmail(data.sendTo, 'Data dump request', generateHtml.htmlValue);
      } else {
        return null;
      }
    } else 
      // RequestType.DestroyAccount
      if (data.requestType == 1) {

      class DeleteData {
        constructor() {
        }
        
        async startCollection(name) {
        }

        async processData(id, doc) {
          await doc.ref.delete();
        }

        async endCollection(name) {
        }
      }

      var deleteData = new DeleteData();
      if (await processData(data, deleteData)) {
        var memberRef = admin.firestore().collection('member').doc(data.authorId);
        if (memberRef != null) {
          await memberRef.delete();
        }
        var memberpublicinfoRef = admin.firestore().collection('memberpublicinfo').doc(data.authorId);
        if (memberpublicinfoRef != null) {
          await memberpublicinfoRef.delete();
        }
        
        return sendEmail(data.sendTo, 'Account deleted', 'We confirm your account has been successfully removed. Sorry to see you go.');
      } else {
        return null;
      }

      
    }
    
    return ;
  } else {
    functions.logger.log('Snap was null');
  }
});

// *******************************************************************************************************
// ***************************************** eliud_pkg_feed **********************************************
// *******************************************************************************************************

const VALUE_SKIP = 0
const VALUE_INCREASE = 1
const VALUE_DECREASE = -1

function updateLikes(val, changeLike, changeDislike) {
  if (val != null) {
    const documentId = val.postId;
    if  (documentId != null) {
      const appId = val.appId;
      if (appId != null) {
        var appRef = admin.firestore().collection('app').doc(appId);
        if (appRef != null) {
          var postRef;
          const postCommentId = val.postCommentId;
          if (postCommentId == null) {
            postRef = appRef.collection('post').doc(documentId);
          } else {
            postRef = appRef.collection('postcomment').doc(postCommentId);
          }
          if (postRef != null) {
            if ((changeLike == VALUE_INCREASE) && (changeDislike == VALUE_INCREASE)) {
              return postRef.update({ 'likes': increment, 'dislikes': increment });
            }
            if ((changeLike == VALUE_INCREASE) && (changeDislike == VALUE_DECREASE)) {
              return postRef.update({ 'likes': increment, 'dislikes': decrement });
            }
            if ((changeLike == VALUE_INCREASE) && (changeDislike == VALUE_SKIP)) {
              return postRef.update({ 'likes': increment });
            }

            if ((changeLike == VALUE_DECREASE) && (changeDislike == VALUE_SKIP)) {
              return postRef.update({ 'likes': decrement });
            }
            if ((changeLike == VALUE_DECREASE) && (changeDislike == VALUE_INCREASE)) {
              return postRef.update({ 'likes': decrement, 'dislikes': increment });
            }
            if ((changeLike == VALUE_DECREASE) && (changeDislike == VALUE_DECREASE)) {
              return postRef.update({ 'likes': decrement, 'dislikes': decrement });
            }

            if ((changeLike == VALUE_SKIP) && (changeDislike == VALUE_INCREASE)) {
              return postRef.update({ 'dislikes': increment });
            }
            if ((changeLike == VALUE_SKIP) && (changeDislike == VALUE_DECREASE)) {
              return postRef.update({ 'dislikes': decrement });
            }

            functions.logger.log('Combination not supported: changeLike = ' + changeLike + ', changeDislike ' + changeDislike);
          } else {
            functions.logger.log('postRef was null');
          }
        } else {
          functions.logger.log('appRef was null');
        }
      } else {
        functions.logger.log('appId was null');
      }
    } else {
      functions.logger.log('documentId was null');
    }
  } else {
    functions.logger.log('Val was null');
  }
  return null;
}

exports.likeSyncCreate = functions.firestore.document('app/{appId}/postlike/{documentId}').onCreate(async (snap, context) => {
  if (snap != null) {
    const val = snap.data();
    // increase the likes
    if (val.likeType == 0) return updateLikes(val, VALUE_INCREASE, VALUE_SKIP);
    if (val.likeType == 1) return updateLikes(val, VALUE_SKIP, VALUE_INCREASE);
    
    functions.logger.log('likeType not supported: ' + likeType);
  } else {
    functions.logger.log('Snap was null');
  }
});

exports.likeSyncUpdate = functions.firestore.document('app/{appId}/postlike/{documentId}').onWrite(async (snap, context) => {
  const afterSnapshot = snap.after;
  if (afterSnapshot != null) {
    const beforeSnapshot = snap.before;
    if (beforeSnapshot != null) {
      const afterVal = afterSnapshot.data();
      if (afterVal != null) {
        const beforeVal = beforeSnapshot.data();
        if (beforeVal != null) {
          if (afterVal.likeType == beforeVal.likeType) return null; // no change of the like itself

          if ((afterVal.likeType == 0) && (beforeVal.likeType == 1)) {
            return updateLikes(afterVal, VALUE_INCREASE, VALUE_DECREASE);
          } else {
            if ((afterVal.likeType == 1) && (beforeVal.likeType == 0)) {
              return updateLikes(afterVal, VALUE_DECREASE, VALUE_INCREASE);
            } else {
              return null;
            }
          }
        } else {
          functions.logger.log('beforeVal was null');
        }
      } else {
        functions.logger.log('afterVal was null');
      }
    } else {
      functions.logger.log('beforeSnapshot was null');
    }
  } else {
    functions.logger.log('afterSnapshot was null');
  }
});

exports.likeSyncDelete = functions.firestore.document('app/{appId}/postlike/{documentId}').onDelete(async (snap, context) => {
  if (snap != null) {
    const val = snap.data();
    // decrease the likes
    if (val.likeType == 0) return updateLikes(val, VALUE_DECREASE, VALUE_SKIP);
    if (val.likeType == 1) return updateLikes(val, VALUE_SKIP, VALUE_DECREASE);
    
    functions.logger.log('likeType was not something I know');
  } else {
    functions.logger.log('snap was null');
  }
  return null;
});

// 2) post
async function updateReadAccessPost(post, documentId) {
  if (post != null) {
    const appId = post.appId;
    var appRef = admin.firestore().collection('app').doc(appId);
    var postRef = appRef.collection('post').doc(documentId);
    if (post.authorId == null) {
      functions.logger.log('author is null for post ' + documentId);
    } else {
      var readAccess;
      if (post.accessibleByGroup == 0) {

        // PUBLIC
        readAccess = ['PUBLIC', post.authorId];

      } else if (post.accessibleByGroup == 1) {

        // FOLLOWERS
        readAccess = await findFollowers(appId, post.authorId);
        readAccess.push(post.authorId);

      } else if (post.accessibleByGroup == 2) {

        // ME
        readAccess = [ post.authorId ];

      } else if (post.accessibleByGroup == 3) {

        // SPECIFIC MEMBERS
        if ((post.accessibleByMembers === undefined) || (post.accessibleByMembers == null)) {

          functions.logger.log('accessibleByMembers == null');
          readAccess = [ post.authorId ];

        } else {

          functions.logger.log('accessibleByMembers != null');
          readAccess = post.accessibleByMembers;
          readAccess.push(post.authorId);
          functions.logger.log('readAccess:');
          functions.logger.log(readAccess);

        }

      } else {
        functions.logger.error('post.accessibleByGroup has unexpected value ' + post.accessibleByGroup);
        return;
      }

      return postRef.update({ 'readAccess': readAccess });
    }
  } else {
    functions.logger.log('memberMedium was null');
  }
}

// 5) memberProfile
async function updateReadAccessMemberProfile(memberProfile, documentId) {
  if (memberProfile != null) {
    const appId = memberProfile.appId;
    var appRef = admin.firestore().collection('app').doc(appId);
    var memberProfileRef = appRef.collection('memberprofile').doc(documentId);
    if (memberProfile.authorId == null) {
      functions.logger.log('author is null for memberProfile ' + documentId);
    } else {
      var readAccess;
      if (memberProfile.accessibleByGroup == 0) {

        // PUBLIC
        readAccess = ['PUBLIC', memberProfile.authorId];

      } else if (memberProfile.accessibleByGroup == 1) {

        // FOLLOWERS
        readAccess = await findFollowers(appId, memberProfile.authorId);
        readAccess.push(memberProfile.authorId);

      } else if (memberProfile.accessibleByGroup == 2) {

        // ME
        readAccess = [ memberProfile.authorId ];

      } else if (memberProfile.accessibleByGroup == 3) {

        // SPECIFIC MEMBERS
        if ((memberProfile.accessibleByMembers === undefined) || (memberProfile.accessibleByMembers == null)) {

          functions.logger.log('accessibleByMembers == null');
          readAccess = [ memberProfile.authorId ];

        } else {

          functions.logger.log('accessibleByMembers != null');
          readAccess = memberProfile.accessibleByMembers;
          readAccess.push(memberProfile.authorId);
          functions.logger.log('readAccess:');
          functions.logger.log(readAccess);

        }

      } else {
        functions.logger.error('memberProfile.accessibleByGroup has unexpected value ' + memberProfile.accessibleByGroup);
        return;
      }

      return memberProfileRef.update({ 'readAccess': readAccess });
    }
  } else {
    functions.logger.log('memberMedium was null');
  }
}

// 2) post
exports.postSyncUpdate = functions.firestore.document('/app/{appid}/post/{documentId}').onWrite(async (snap, context) => {
  functions.logger.log('postSyncUpdate');
  
  const afterSnapshot = snap.after;
  if (afterSnapshot != null) {
    const post = afterSnapshot.data();
    const documentId = context.params.documentId;
    return updateReadAccessPost(post, documentId);
  } else {
    functions.logger.log('afterSnapshot was null');
  }
});

// 5) memberProfile
exports.memberProfileSyncUpdate = functions.firestore.document('/app/{appid}/memberprofile/{documentId}').onWrite(async (snap, context) => {
  functions.logger.log('memberProfileSyncUpdate');
  
  const afterSnapshot = snap.after;
  if (afterSnapshot != null) {
    const memberProfile = afterSnapshot.data();
    const documentId = context.params.documentId;
    return updateReadAccessMemberProfile(memberProfile, documentId);
  } else {
    functions.logger.log('afterSnapshot was null');
  }
});

// *********************************************************************************************************
// ***************************************** eliud_pkg_follow **********************************************
// *********************************************************************************************************

// following > followingarray 
// followingarray is an array representation of following, intended to limit reading plenty of documents when determing readAccess

async function updateFollowingArray(followingDoc) {
  const appId = followingDoc.appId;
  const followedId = followingDoc.followedId;
  const followerId = followingDoc.followerId;
  var appRef = admin.firestore().collection('app').doc(appId);
  if (appRef != null) {
    var followingArrayRef = appRef.collection('followingarray').doc(followedId);
    if (followingArrayRef != null) {
      const followingArrayDoc = await followingArrayRef.get();
      if (!followingArrayDoc.exists) {
        functions.logger.log('!followingArrayDoc.exists');
        return followingArrayRef.set({
          'followers': [followerId]
        });
      } else {
        functions.logger.log('followingArrayDoc.exists');
        var followingArrayData = followingArrayDoc.data();
        var followers = followingArrayData.followers;
        functions.logger.log('followers:');
        functions.logger.log(followers);
        if (followers === undefined) {
          return followingArrayRef.set({
            'followers': []
          });
        } else if (!followers.includes(followerId)) {
          followers.push(followerId);
          return followingArrayRef.update({
            'followers': followers 
          });
        }
      }
    }
  } else {
    functions.logger.log('appp document for ' + appId + ' does not exist');
  }
}

async function removeFollowerFromFollowingArray(followingDoc) {
  const appId = followingDoc.appId;
  const followedId = followingDoc.followedId;
  const followerId = followingDoc.followerId;
  var appRef = admin.firestore().collection('app').doc(appId);
  if (appRef != null) {
    var followingArrayRef = appRef.collection('followingarray').doc(followedId);
    if (followingArrayRef != null) {
      const followingArrayDoc = await followingArrayRef.get();
      if (!followingArrayDoc.exists) {
        functions.logger.error('This is a case that shouldnt exist: a follower gets removed as follwer, yet the person he follows does not have followers. Regardless, we update the followers appropriately');
        return followingArrayRef.set({
          'followers': []
        });
      } else {
        functions.logger.log('followingArrayDoc.exists');
        var followingArrayData = followingArrayDoc.data();
        var followers = followingArrayData.followers;
        functions.logger.log('followers before:');
        functions.logger.log(followers);
        if (followers === undefined) {
          return followingArrayRef.set({
            'followers': []
          });
        } else if (followers.includes(followerId)) {
          var newFollowers = followers.filter(function(elem){ 
            return elem != followerId;
          });
          functions.logger.log('newFollowers after:');
          functions.logger.log(newFollowers);
          return followingArrayRef.update({
            'followers': newFollowers
          });
        }
      }
    }
  } else {
    functions.logger.log('appp document for ' + appId + ' does not exist');
  }
}

// A follower has been deleted... Make sure to remove that person from the readAccess list 
// in memberMedium, chat, chatMemberInfo, memberProfile, post
//
async function updateFollowersDataRemoveMember(followingDoc) {
  const appId = followingDoc.appId;
  const followedId = followingDoc.followedId;
  const followerId = followingDoc.followerId;
  var appRef = admin.firestore().collection('app').doc(appId);
  if (appRef != null) {
    var appRef = admin.firestore().collection('app').doc(appId);

    // 1) memberMedium
    var memberMediumRef = appRef.collection('membermedium');
    const allMemberMedium = await memberMediumRef.where("accessibleByGroup", "==", 1).where("readAccess", "array-contains", followerId).get();

    if (!allMemberMedium.empty) {
      await allMemberMedium.forEach(async (memberMedium) => {
        var memberMediumData = memberMedium.data();
        console.log("memberMedium.id: " + memberMediumData.id);
        var readAccess = memberMediumData.readAccess;
        console.log("readAccess before", readAccess);
        var newReadAccess = readAccess.filter(function(elem){ 
          return elem != followerId;
        });
        
        console.log("readAccess after", newReadAccess);
        await memberMedium.ref.update({ 'readAccess': newReadAccess });
      });
    }
    
    // 2) post
    var postRef = appRef.collection('post');
    const allPost = await postRef.where("accessibleByGroup", "==", 1).where("readAccess", "array-contains", followerId).get();

    if (!allPost.empty) {
      await allPost.forEach(async (post) => {
        var postData = post.data();
        console.log("post.id: " + postData.id);
        var readAccess = postData.readAccess;
        console.log("readAccess before", readAccess);
        var newReadAccess = readAccess.filter(function(elem){ 
          return elem != followerId;
        });
        
        console.log("readAccess after", newReadAccess);
        await post.ref.update({ 'readAccess': newReadAccess });
      });
    }
    
    // 3) memberProfile
    var memberProfileRef = appRef.collection('memberprofile');
    const allMemberProfile = await memberProfileRef.where("accessibleByGroup", "==", 1).where("readAccess", "array-contains", followerId).get();

    if (!allMemberProfile.empty) {
      await allMemberProfile.forEach(async (memberProfile) => {
        var memberProfileData = memberProfile.data();
        console.log("memberProfile.id: " + memberProfileData.id);
        var readAccess = memberProfileData.readAccess;
        console.log("readAccess before", readAccess);
        var newReadAccess = readAccess.filter(function(elem){ 
          return elem != followerId;
        });
        
        console.log("readAccess after", newReadAccess);
        await memberProfile.ref.update({ 'readAccess': newReadAccess });
      });
    }
    
  } else {
    functions.logger.log('appp document for ' + appId + ' does not exist');
  }
}

// A follower has been created... Make sure to add that person from the readAccess list 
// in memberMedium, chat, chatMemberInfo, memberProfile, post
//
async function updateFollowersDataAddMember(followingDoc) {
  const appId = followingDoc.appId;
  const followedId = followingDoc.followedId;
  const followerId = followingDoc.followerId;
  var appRef = admin.firestore().collection('app').doc(appId);
  if (appRef != null) {
    var appRef = admin.firestore().collection('app').doc(appId);

    // 1) memberMedium
    var memberMediumRef = appRef.collection('membermedium');
    const allMemberMedium = await memberMediumRef.where("accessibleByGroup", "==", 1).get();

    if (!allMemberMedium.empty) {
      allMemberMedium.forEach(memberMedium => {
        var memberMediumData = memberMedium.data();
        console.log("memberMedium.id: " + memberMediumData.id);
        var newReadAccess = memberMediumData.readAccess;
        console.log("newReadAccess before " + newReadAccess);
        newReadAccess.push(followerId);
        console.log("newReadAccess after " + newReadAccess);
        return memberMedium.ref.update({
          'readAccess': newReadAccess
        });
      });
    }
    
    // 2) post
    var postRef = appRef.collection('post');
    const allPost = await postRef.where("accessibleByGroup", "==", 1).get();

    if (!allPost.empty) {
      allPost.forEach(post => {
        var postData = post.data();
        console.log("post.id: " + postData.id);
        var newReadAccess = postData.readAccess;
        console.log("newReadAccess before " + newReadAccess);
        newReadAccess.push(followerId);
        console.log("newReadAccess after " + newReadAccess);
        return post.ref.update({
          'readAccess': newReadAccess
        });
      });
    }
    
    // 3) memberProfile
    var memberProfileRef = appRef.collection('memberprofile');
    const allMemberProfile = await memberProfileRef.where("accessibleByGroup", "==", 1).get();

    if (!allMemberProfile.empty) {
      allMemberProfile.forEach(memberProfile => {
        var memberProfileData = memberProfile.data();
        console.log("memberProfile.id: " + memberProfileData.id);
        var newReadAccess = memberProfileData.readAccess;
        console.log("newReadAccess before " + newReadAccess);
        newReadAccess.push(followerId);
        console.log("newReadAccess after " + newReadAccess);
        return memberProfile.ref.update({
          'readAccess': newReadAccess
        });
      });
    }
    
  } else {
    functions.logger.log('appp document for ' + appId + ' does not exist');
  }
}

exports.followingSyncUpdate = functions.firestore.document('/app/{appid}/following/{documentId}').onUpdate(async (snap, context) => {
  functions.logger.error('NOT ANTICIPATING onUpdate for following');
});

exports.followingSyncDelete = functions.firestore.document('/app/{appid}/following/{documentId}').onDelete(async (snap, context) => {
  functions.logger.log('followingSyncDelete');
  const followingDoc = snap.data();
  await removeFollowerFromFollowingArray(followingDoc);
  return updateFollowersDataRemoveMember(followingDoc);
});

exports.followingSyncCreate = functions.firestore.document('/app/{appid}/following/{documentId}').onCreate(async (snap, context) => {
  functions.logger.log('followingSyncCreate');
  const followingDoc = snap.data();
  await updateFollowingArray(followingDoc);
  return updateFollowersDataAddMember(followingDoc);
});

// *******************************************************************************************************
// ***************************************** eliud_pkg_text **********************************************
// *******************************************************************************************************

// 6) htmlwithmembermedium
async function updateReadAccessHtmlWithMemberMedium(htmlWithMemberMedium, documentId) {
  if (htmlWithMemberMedium != null) {
    const appId = htmlWithMemberMedium.appId;
    var appRef = admin.firestore().collection('app').doc(appId);
    var memberProfileRef = appRef.collection('htmlWithMemberMedium').doc(documentId);
    if (htmlWithMemberMedium.authorId == null) {
      functions.logger.log('author is null for memberProfile ' + documentId);
    } else {
      var readAccess;
      if (memberProfile.accessibleByGroup == 0) {

        // PUBLIC
        readAccess = ['PUBLIC', memberProfile.authorId];

      } else if (memberProfile.accessibleByGroup == 1) {

        // FOLLOWERS
        readAccess = await findFollowers(appId, memberProfile.authorId);
        readAccess.push(memberProfile.authorId);

      } else if (memberProfile.accessibleByGroup == 2) {

        // ME
        readAccess = [ memberProfile.authorId ];

      } else if (memberProfile.accessibleByGroup == 3) {

        // SPECIFIC MEMBERS
        if ((memberProfile.accessibleByMembers === undefined) || (memberProfile.accessibleByMembers == null)) {

          functions.logger.log('accessibleByMembers == null');
          readAccess = [ memberProfile.authorId ];

        } else {

          functions.logger.log('accessibleByMembers != null');
          readAccess = memberProfile.accessibleByMembers;
          readAccess.push(memberProfile.authorId);
          functions.logger.log('readAccess:');
          functions.logger.log(readAccess);

        }

      } else {
        functions.logger.error('memberProfile.accessibleByGroup has unexpected value ' + memberProfile.accessibleByGroup);
        return;
      }

      return memberProfileRef.update({ 'readAccess': readAccess });
    }
  } else {
    functions.logger.log('memberMedium was null');
  }
}

// *******************************************************************************************************
// ***************************************** eliud_pkg_chat **********************************************
// *******************************************************************************************************

// 3) chat
async function updateReadAccessChat(chat, roomId, documentId) {
  if (chat != null) {
    const appId = chat.appId;
    var appRef = admin.firestore().collection('app').doc(appId);
    var roomRef = appRef.collection('room').doc(roomId);
    var chatRef = roomRef.collection('chat').doc(documentId);
    if (chat.authorId == null) {
      functions.logger.log('author is null for chat ' + documentId);
    } else {
      var readAccess;
      if (chat.accessibleByGroup == 0) {

        // PUBLIC
        readAccess = ['PUBLIC', chat.authorId];

      } else if (chat.accessibleByGroup == 1) {

        // FOLLOWERS
        readAccess = await findFollowers(appId, chat.authorId);
        readAccess.push(chat.authorId);

      } else if (chat.accessibleByGroup == 2) {

        // ME
        readAccess = [ chat.authorId ];

      } else if (chat.accessibleByGroup == 3) {

        // SPECIFIC MEMBERS
        if ((chat.accessibleByMembers === undefined) || (chat.accessibleByMembers == null)) {

          functions.logger.log('accessibleByMembers == null');
          readAccess = [ chat.authorId ];

        } else {

          functions.logger.log('accessibleByMembers != null');
          readAccess = chat.accessibleByMembers;
          functions.logger.log('readAccess before:');
          functions.logger.log(readAccess);
          readAccess.push(chat.authorId);
          functions.logger.log('readAccess:');
          functions.logger.log(readAccess);

        }

      } else {
        functions.logger.error('chat.accessibleByGroup has unexpected value ' + chat.accessibleByGroup);
        return;
      }

      return chatRef.update({ 'readAccess': readAccess });
    }
  } else {
    functions.logger.log('memberMedium was null');
  }
}

// 4) chatMemberInfo
async function updateReadAccessChatMemberInfo(chatMemberInfo, roomId, documentId) {
  if (chatMemberInfo != null) {
    const appId = chatMemberInfo.appId;
    var appRef = admin.firestore().collection('app').doc(appId);
    var roomRef = appRef.collection('room').doc(roomId);
    var chatMemberInfoRef = roomRef.collection('chatmemberinfo').doc(documentId);
    if (chatMemberInfo.authorId == null) {
      functions.logger.log('author is null for chatMemberInfo ' + documentId);
    } else {
      var readAccess;
      if (chatMemberInfo.accessibleByGroup == 0) {

        // PUBLIC
        readAccess = ['PUBLIC', chatMemberInfo.authorId];

      } else if (chatMemberInfo.accessibleByGroup == 1) {

        // FOLLOWERS
        readAccess = await findFollowers(appId, chatMemberInfo.authorId);
        readAccess.push(chatMemberInfo.authorId);

      } else if (chatMemberInfo.accessibleByGroup == 2) {

        // ME
        readAccess = [ chatMemberInfo.authorId ];

      } else if (chatMemberInfo.accessibleByGroup == 3) {

        // SPECIFIC MEMBERS
        if ((chatMemberInfo.accessibleByMembers === undefined) || (chatMemberInfo.accessibleByMembers == null)) {

          functions.logger.log('accessibleByMembers == null');
          readAccess = [ chatMemberInfo.authorId ];

        } else {

          functions.logger.log('accessibleByMembers != null');
          readAccess = chatMemberInfo.accessibleByMembers;
          functions.logger.log('readAccess before:');
          functions.logger.log(readAccess);
          readAccess.push(chatMemberInfo.authorId);
          functions.logger.log('readAccess:');
          functions.logger.log(readAccess);

        }

      } else {
        functions.logger.error('chatMemberInfo.accessibleByGroup has unexpected value ' + chatMemberInfo.accessibleByGroup);
        return;
      }

      return chatMemberInfoRef.update({ 'readAccess': readAccess });
    }
  } else {
    functions.logger.log('memberMedium was null');
  }
}

// 3) chat
exports.chatSyncUpdate = functions.firestore.document('/app/{appid}/room/{roomId}/chat/{documentId}').onWrite(async (snap, context) => {
  functions.logger.log('chatSyncUpdate');
  
  const afterSnapshot = snap.after;
  if (afterSnapshot != null) {
    const chat = afterSnapshot.data();
    const roomId = context.params.roomId;
    functions.logger.log('roomId: ' + roomId);
    const documentId = context.params.documentId;
    return updateReadAccessChat(chat, roomId, documentId);
  } else {
    functions.logger.log('afterSnapshot was null');
  }
});

// 4) chatMemberInfo
exports.chatMemberInfoSyncUpdate = functions.firestore.document('/app/{appid}/room/{roomId}/chatmemberinfo/{documentId}').onWrite(async (snap, context) => {
  functions.logger.log('chatMemberInfoSyncUpdate');
  
  const afterSnapshot = snap.after;
  if (afterSnapshot != null) {
    const chatMemberInfo = afterSnapshot.data();
    const roomId = context.params.roomId;
    const documentId = context.params.documentId;
    return updateReadAccessChatMemberInfo(chatMemberInfo, roomId, documentId);
  } else {
    functions.logger.log('afterSnapshot was null');
  }
});

// chat 
// The "HasChat" collection
//
//   - does not mean "There are new messages to be read".
//   - does mean "There are new messages to be read since the last time you checked ANY".
//
// When a chat entry is created, we indicate that there's a new message for that member
// When 1 (not all) chat entries are read, then we indicate there's no new message
// It does mean that when you read 1 message, you must have seen there are other messages to be read. 
// If you ignore those, than so be it. You won't have the big indicator "you have chat"

function createHasChat(appRef, appId, memberId, value) {
  appRef.collection('memberhaschat').doc(memberId).set({
    'appId': appId,
    'memberId': memberId,
    'hasUnread': value
  })
  .then(() => {
    console.log("Document successfully written!");
  })
  .catch((error) => {
    console.error("Error writing document: ", error);
  });
}

async function updateChat(snap, context) {
  const afterSnapshot = snap.after;
  if (afterSnapshot != null) {
    const afterVal = afterSnapshot.data();
    if (afterVal != null) {
      var appId = afterVal.appId;
      var roomId = afterVal.roomId;
      var appRef = admin.firestore().collection('app').doc(appId);
      if (appRef != null) {
        const timestamp = afterVal.timestamp;
        var roomRef = appRef.collection('room').doc(roomId);
        if (roomRef != null) {
          var returnMe = roomRef.update({ 'timestamp': timestamp });
          const roomDoc = await roomRef.get();
          if (roomDoc.exists) {
            var roomData = roomDoc.data();
            var members = roomData.members;
            var authorId = afterVal.authorId;
            functions.logger.log('authorId');
            functions.logger.log(authorId);
            functions.logger.log('end authorId');
            if (members != null) {
              members.forEach(memberId => {
                if (memberId != authorId) {
                  createHasChat(appRef, appId, memberId, true);
                }
              });
            } else {
              functions.logger.log('members array was null');
            }
          } else {
            functions.logger.log('roomDoc does not exist');
          }
          functions.logger.log('step return');
          return returnMe;
        } else {
          functions.logger.log('roomRef was null');
        }
      } else {
        functions.logger.log('appRef was null');
      }
    } else {
      functions.logger.log('afterVal was null');
    }
  } else {
    functions.logger.log('afterSnapshot was null');
  }
}

exports.chatWrite = functions.firestore.document('app/{appId}/room/{roomId}/chat/{chatId}').onWrite(async (snap, context) => {
  return updateChat(snap, context);
});

function updateMemberChatInfo(snap, context) {
  const afterSnapshot = snap.after;
  if (afterSnapshot != null) {
    const afterVal = afterSnapshot.data();
    if (afterVal != null) {
      var appId = afterVal.appId;
      var roomId = afterVal.roomId;
      var memberId = afterVal.authorId;
      var appRef = admin.firestore().collection('app').doc(appId);
      return createHasChat(appRef, appId, memberId, false);
    } else {
      functions.logger.log('afterVal was null');
    }
  } else {
    functions.logger.log('afterSnapshot was null');
  }
}

exports.chatMemberInfoWrite = functions.firestore.document('app/{appId}/room/{roomId}/chatmemberinfo/{chatmemberinfoId}').onWrite(async (snap, context) => {
  return updateMemberChatInfo(snap, context);
});

// *******************************************************************************************************
// ***************************************** eliud_pkg_shop **********************************************
// *******************************************************************************************************

// Sends an email confirmation when a user changes his mailing list subscription. This function is secured in that no http access is available and google firestore rules apply
exports.sendOrderConfMail = functions.firestore.document('/app/{appid}/' + collectionName + '/{uid}').onWrite(async (change, context) => {
  console.log("sendOrderConfMail");

  const snapshot = change.after;
  const val = snapshot.data();

  const status = val.status;
  //If status is not Paid, then return
  if (status != 1) {
    return null;
  }

  const documentID = snapshot.id;
  
  var text = '<p>Your order with order number ' + documentID + ' is confirmed and we are working hard to ship this to you. Ones shipped we will notify you</p>';
  text = text + '<p>';
  text = text + '<p>Contact: ' + val.email + '</p>';
  text = text + '<p>';
  text = text + '<p>Payment Reference:' + val.paymentReference + '</p>';
  text = text + '<p>';
  text = text + '<p>Ship To:';
  text = addValueToStringNoQ(text, val.shipStreet1);
  text = addValueToStringNoQ(text, val.shipStreet2);
  text = addValueToStringNoQ(text, val.postcode);
  text = addValueToStringNoQ(text, val.shipCity);
  text = addValueToStringNoQ(text, val.shipState);
  if (val.country != null)
    text = addValueToStringNoQ(text, val.country.countryName);
  text = text + '</p>';
  text = text + '<p>';
  text = text + '<p>Your order:</p>';
  text = text + '<p>';

  text = text + '<ul>';
  var products = val.products;
  for (var product of products) {
    text = text + '<li>';
    text = addValueToString(text, product.amount);
    text = addStringToString(text, product.productId); 
    text = addValueToString(text, product.soldPrice);
    text = addStringToString(text, val.currency); 
    text = text + '</li>';
  }
  text = text + '</ul>';
  text = text + '<p>';
  text = text + '<p>Total price:';
  text = addValueToString(text, val.totalPrice);
  text = addStringToString(text, val.currency);
  text = text + '</p>';
  text = text + '<p>';
  text = text + '<p>Thank you for shopping at ' + appName + '</p>';

  return sendEmail(val.email, 'Order confirmation', text);
});

// etc 

function addStringToString(addHere, addThis) {
  if (addThis!= null) 
    return addHere + addThis + ' ';
  else
    return addHere + '? ';
}

function addValueToString(addHere, addThis) {
  if (addThis!= null) 
    return addHere + addThis.toString() + ' ';
  else
    return addHere + '? ';
}

function addValueToStringNoQ(addHere, addThis) {
  if (addThis!= null) 
    return addHere + addThis.toString() + ' ';
  else
	return addHere;
}

// ******************************************************************************************************
// ***************************************** eliud_pkg_pay **********************************************
// ******************************************************************************************************

// stripe
const stripe = require('stripe')(functions.config().stripe.secret, {
  apiVersion: '2020-03-02',
});

exports.createPaymentIntent = functions.https.onCall((data, context) => {
    return stripe.paymentIntents.create({
      amount: data.amount,
      currency: data.currency,
      payment_method_types: ['card']
    });
})
