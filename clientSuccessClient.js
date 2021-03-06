const JS     = require('@roadmunk/jsclass');
const axios  = require('axios');
const _      = require('lodash');
const Moment = require('moment');

const RETRY_LIMIT                  = 10;	// number of retry attempts for any given API call
const URL                          = 'https://api.clientsuccess.com/v1/';

const ClientSuccessClient = module.exports                  = JS.class('ClientSuccessClient');
const CustomError         = ClientSuccessClient.CustomError = JS.class('CustomError');

JS.class(ClientSuccessClient, {
	fields : {
		username        : null,
		password        : null,
		authToken       : null,
		clientTypes     : null,
		eventsProjectID : null,
		eventsAPIKey    : null,
	},

	constructor : function(username, password, eventsProjectID, eventsAPIKey) {
		this.username        = username;
		this.password        = password;
		this.eventsProjectID = eventsProjectID;
		this.eventsAPIKey    = eventsAPIKey;
	},

	methods : {
		/**
		 * Authenticate with ClientSuccess.
		 */
		authenticate : async function() {
			try {
				const response = await axios({
					method : 'POST',
					url    : `${URL}auth`,
					data   : {
						username : this.username,
						password : this.password,
					},
				});
				if (_.get(response, 'data.access_token')) {
					this.authToken = response.data.access_token;
				}
			}
			catch (error) {
				if (error.response.status == 401) {
					throw new CustomError({ status : 401, message : 'Authentication Error' });
				}

				throw new CustomError({ status : 400, message : 'Invalid Request' });
			}
		},

		/**
		 * Hit the ClientSuccess API with provided perameters. Also catch and handle bad response codes.
		 * @param {String} method         - Type of the API call.
		 * @param {String} path           - URI path of the ClientSuccess endpoint
		 * @param {Object} data           - Dataset that will be passed through to the ClientSuccess API endpoint.
		 * @returns {Object|null}         - response body from the HTTP request
		 */
		hitClientSuccessAPI : async function(method, path, data) {
			if (!method) {
				throw new CustomError({ status : 400, message : 'API Method Required' });
			}

			// Retry for block to re-attempt API call if an expired token is encountered
			for (let retry = 0; retry < RETRY_LIMIT; retry++) {
				if (!this.authToken) {
					await this.authenticate();
				}

				try {
					const response = await axios({
						method,
						url     : URL + path,
						headers : { Authorization : this.authToken },
						data,
					});

					return response.data;
				}
				catch (error) {
					if (error.response.status === 401) {
						this.authToken = null;
					}
					else if (error.response.status === 503) {
						throw new CustomError({ status : 503, message : 'Service Temporarily Unavailable', userMessage : error.response.data.userMessage });
					}
					else if (error.response.status === 417) {
						throw new CustomError({ status : 417, message : 'Expectation Failed', userMessage : error.response.data.userMessage });
					}
					else if (error.response.status === 404) {
						throw new CustomError({ status : 404, message : 'Not Found', userMessage : error.response.data.userMessage });
					}
					else if (error.response.status === 400) {
						throw new CustomError({ status : 400, message : 'Bad Request', userMessage : error.response.data.userMessage });
					}
					else {
						throw new CustomError({ status : error.response.status, message : error.response.message, userMessage : error.response.data.userMessage });
					}
				}
			}
			throw new CustomError({ status : 429, message : 'Too Many Requests' });
		},

		/**
		 * Get ClientSuccess client object.
		 * @param {String} clientId  - Client ID of the ClientSuccess Client
		 * @returns {Object}         - ClientSuccess Client Data object
		 */
		getClient : function(clientId) {
			this.validateClientSuccessId(clientId);

			return this.hitClientSuccessAPI('GET', `clients/${clientId}`);
		},

		/**
		 * Get ClientSuccess Client object by the externalId attribute
		 * @param {String} externalId - External ID of Client
		 * @returns Promise<Object>   - Promise with ClientSuccess Client Data object
		 */
		getClientByExternalId : function(externalId) {
			if (!externalId || !_.isString(externalId)) {
				throw new CustomError({ status : 400, message : 'Invalid externalId for getClientByExternalId.' });
			}

			return this.hitClientSuccessAPI('GET', `clients/?externalId=${externalId}`);
		},

		/**
		 * Create a ClientSuccess client.
		 * @param {Object} attributes       - Attributes of the Client
		 * @param {Object} customAttributes - Custom attributes of the Client
		 * @returns {Object}                - Resulting Client object
		 */
		createClient : async function(attributes, customAttributes) {
			// Check to make sure that there isn't already a client based on externalId
			if (attributes.externalId) {
				try {
					const foundClient = await this.getClientByExternalId(attributes.externalId);
					return this.updateClient(foundClient.id, attributes, customAttributes);
				}
				catch (error) {
					if (error.status !== 404) {
						throw new CustomError({ status : error.status, message : error.message });
					}
					// Else, user was not found, therefore continue to creation
				}
			}

			const createdUser = await this.hitClientSuccessAPI('POST', 'clients', attributes);

			if (!customAttributes) {
				return createdUser;
			}

			// update the created user with the custom attributes
			// ClientSuccess requires that we pass through ALL custom attributes in the update statement
			return this.updateClient(createdUser.id, attributes, customAttributes);
		},

		/**
		 * Update a ClientSuccess client object.
		 * @param {String} clientId         - ClientSuccess clientId
		 * @param {Object} attributes       - Attributes and values that are to be updated
		 * @param {Object} customAttributes - Custom attributes that need to be set for the ClientSuccess Client Object
		 * @returns Promise<Object>         - Promise with the object of the resulting updated Client
		 */
		updateClient : async function(clientId, attributes, customAttributes) {
			// ClientSuccess requires that all 'required' fields to be passed through to the update API
			this.validateClientSuccessId(clientId);
			// First, get the current client state data, and only modify what is needing updating
			const clientToUpdate = await this.getClient(clientId);
			Object.assign(clientToUpdate, attributes);
			this.patchCustomAttributes(clientToUpdate, customAttributes);
			return this.hitClientSuccessAPI('PUT', `/clients/${clientId}`, clientToUpdate);
		},

		/**
		 * Creates or updates a client with the given attributes.
		 * @param  {String} [clientId=undefined]
		 * @param  {Object} attributes
		 * @return {Object} resulting upserted Client
		 */
		upsertClient : async function({ clientId = undefined, attributes = {}, customAttributes = {} } = {}) {
			if (!clientId) {
				// no client ID, create the Client
				const createdClient = await this.createClient(attributes, customAttributes);
				return this.getClient(createdClient.id); // return fresh model that includes custom attributes
			}
			const updatedClient = await this.updateClient(clientId, attributes, customAttributes);
			return this.getClient(updatedClient.id);
		},

		/**
		 * Close the ClientSuccess Client object by setting the statusId to "4", which equals "Terminated"
		 * Closing a client hides it from the front-end UI
		 * @param  {String} clientId - Client ID of the Client that will be closed
		 * @return {Object}          - The object of the resulting closed Client
		 */
		closeClient : function(clientId) {
			return this.updateClient(clientId, { statusId : 4 });
		},

		/**
		 * Deletes a client from ClientSuccess with the given ID
		 * @param  {String} clientId - Client ID of the Client that will be deleted
		 * @return Promise<Object>   - Promise with the response from the ClientSuccess API
		 */
		deleteClient : function(clientId) {
			if (!clientId) {
				throw new CustomError({ status : 400, message : 'Client ID Required for Deletion' });
			}

			return this.hitClientSuccessAPI('DELETE', `clients/${clientId}`);
		},

		/**
		 * Get ClientSuccess Contact detail object.
		 * @param {String} clientId  - ClientSuccess Client ID that contains the Contact
		 * @param {String} contactId - ClientSuccess Contact ID
		 * @returns {Object}         - ClientSuccess Contact Detail object of the located contact.
		 */
		getContact : async function(clientId, contactId) {
			this.validateClientSuccessId(clientId);
			this.validateClientSuccessId(contactId);

			let foundClient;
			try {
				foundClient = await this.hitClientSuccessAPI('GET', `clients/${clientId}/contacts/${contactId}/details`);
			}
			catch (error) {
				if (error.status === 417) {
					// Contact was not found, return a 404 instead of a 417
					// This is an issue with the ClientSuccess API as of 2018-08-10, that will be addressed in V2 of their API
					throw new CustomError({ status : 404, message : 'Contact not found', userMessage : error.userMessage });
				}
				else {
					throw new CustomError({ status : error.status, message : error.message, userMessage : error.userMessage });
				}
			}

			return foundClient;
		},

		/**
		 * Gets the ClientSuccess Contact object using both the Client External ID and the Contact Email
		 * Preferred to pull by ClientSuccess Client ID, but this method is not supported yet.
		 * @param  {String} clientExternalId - Client External ID of the Client to be searched
		 * @param  {String} contactEmail     - Email of the Contact
		 * @return Promise<Object>           - Contact Object of the found contact
		 */
		getContactByEmail : async function(clientExternalId, contactEmail) {
			if (!clientExternalId || !contactEmail) {
				throw new CustomError({ status : 400, message : 'Invalid clientExternalId or contactEmail for getContactByEmail' });
			}

			const foundContact = await this.hitClientSuccessAPI(
				'GET',
				`contacts?clientExternalId=${clientExternalId}&email=${encodeURIComponent(contactEmail)}`
			);

			if (!foundContact) {
				throw new CustomError({ status : 404, message : 'Contact not found' });
			}

			return foundContact;
		},

		/**
		 * Create a ClientSuccess Contact.
		 * @param {String} clientId         - ClientSuccess Client ID that is to be created under the contact
		 * @param {String} attributes       - Contact Attributes that the Contact will be created with
		 * @param {Object} customAttributes - Custom attributes that the Contact will be created with
		 * @returns {Object}                - ClientSuccess Contact object that has been created
		 */
		createContact : async function(clientId, attributes, customAttributes) {
			this.validateClientSuccessId(clientId);
			const createdContact = await this.hitClientSuccessAPI('POST', `clients/${clientId}/contacts`, attributes);

			if (!customAttributes) {
				return createdContact;
			}

			// else, update the contact with custom attributes
			return this.updateContact(clientId, createdContact.id, attributes, customAttributes);
		},

		/**
		 * Update a ClientSuccess Contact object.
		 * @param {String} clientId         - ClientSuccess Client ID that the Contact is contained within.
		 * @param {String} contactId        - ClientSuccess Contact ID of the user that is to be updated.
		 * @param {Object} attributes       - Attributes that are to be updated in the ClientSuccess Contact object.
		 * @param {Object} customAttributes - Custom attributes that are to be updated in the Contact object
		 * @returns Promise<Object>         - Promise with the contact data model of the newly updated contact.
		 */
		updateContact : async function(clientId, contactId, attributes, customAttributes) {
			this.validateClientSuccessId(clientId);
			this.validateClientSuccessId(contactId);

			const contactToUpdate = await this.getContact(clientId, contactId);
			Object.assign(contactToUpdate, attributes);
			this.patchCustomAttributes(contactToUpdate, customAttributes);
			return this.hitClientSuccessAPI('PUT', `clients/${clientId}/contacts/${contactId}/details`, contactToUpdate);
		},

		/**
		 * Creates or updates a Contact based on the attributes provided
		 * @param  {String} clientId         ClientSuccess ID of the Client that will contain the Contact
		 * @param  {String} [contactId]      If provided, it will trigger an update, else it will create a new Contact
		 * @param  {Object} attributes       ClientSuccess native Contact attributes to fill
		 * @param  {Object} customAttributes ClientSuccess Contact custom attributes to fill
		 * @return {Object}                  Resulting Contact data object
		 */
		upsertContact : async function({ clientId = undefined, contactId = undefined, attributes = {}, customAttributes = {} } = {}) {
			this.validateClientSuccessId(clientId);

			if (!contactId) {
				let contact;
				const client = await this.getClient(clientId);
				try {
					contact = await this.getContactByEmail(client.externalId, attributes.email);
				}
				catch (error) {
					// contact not found, therefore create it
					if (error.status === 404) {
						contact = await this.createContact(clientId, attributes, customAttributes);
					}
					else {
						throw new CustomError({ status : error.status, message : error.message });
					}
				}

				contactId = contact.id;
				let updateContactAttributes = Object.assign({}, contact); // clone the client object for comparison purposes
				if (!_.get(updateContactAttributes, 'customFieldValues[0]')) {
					// The ClientSuccess create contact API does not return back clean custom attributes, only null values
					updateContactAttributes = await this.getContact(clientId, contactId);
				}
				this.patchCustomAttributes(updateContactAttributes, customAttributes);
				// check to see if a customAttribute update is required
				if (_.isEqual(Object.assign(updateContactAttributes, attributes), contact)) {
					return contact;
				}
			}

			return this.updateContact(clientId, contactId, attributes, customAttributes);
		},

		/**
		 * Deletes a contact from ClientSuccess with the given IDs
		 * @param  {String} clientId  - Client ID of the client the contact is part of
		 * @param  {String} contactId - Contact ID of the contact to be deleted
		 * @return Promise<Object>    - Promise with the response from the ClientSuccess API
		 */
		deleteContact : async function(clientId, contactId) {
			if (!clientId || !contactId) {
				throw new CustomError({ status : 400, message : 'Client ID and Contact ID Required for Deletion' });
			}

			if (!(await this.doesContactBelongToClient(clientId, contactId))) {
				throw new CustomError({ status : 404, message : 'Client not found for contact with that id' });
			}

			return this.hitClientSuccessAPI('DELETE', `clients/${clientId}/contacts/${contactId}`);
		},

		/**
		 * Finds the Client Type ID associated with the ClientSuccess Client Type Title
		 * @param  {String} clientTypeString - Title of the Client Type
		 * @return {Number}                  - ID of the Client Type
		 */
		getClientTypeId : async function(clientTypeString) {
			if (!clientTypeString) {
				throw new CustomError({ status : 400, message : 'No clientTypeString provided in getClientTypeId' });
			}

			if (!this.clientTypes) {
				this.clientTypes = await this.hitClientSuccessAPI('GET', 'client-segments');
			}

			const clientType = _.find(this.clientTypes, { title : clientTypeString });

			if (clientType) {
				return clientType.id;
			}

			throw new CustomError({ status : 404, message : `Requested client type ${clientTypeString} was not found` });
		},

		/**
		 * Helper function for patching a ClientSuccess object's custom attributes.
		 * Uses the ClientSuccess 'Label' field for matching up the passed in custom attributes to the ClientSuccess Client/Contact object
		 * @private
		 * @param  {Object} object           - Object that is to be patched
		 * @param  {Object} customAttributes - Object of custom attributes and their desired values (keyed on custom attribute label)
		 */
		patchCustomAttributes : function(object, customAttributes) {
			if (customAttributes) {
				_.forEach(customAttributes, function(customAttribute, customAttributeKey) {
					_.forEach(object.customFieldValues, function(customFieldObject) {
						if (customAttributeKey === customFieldObject.label) {
							customFieldObject.value = customAttribute;
						}
					});
				});
			}
		},

		/**
		 * Quickly validate if a value is valid to be sent to ClientSuccess
		 * @private
		 * @param  {String} clientSuccessId ClientSuccess ID that is to be validated
		 */
		validateClientSuccessId : function(clientSuccessId) {
			if (!clientSuccessId || isNaN(parseInt(clientSuccessId))) {
				throw new CustomError({ status : 400, message : 'Invalid ClientSuccess ID' });
			}
		},

		/**
		 * Check if the id of the contact passed in belongs to the client id thats passed in.
		 * This is done through a GET api call since ClientSuccess contains this logic when
		 * hitting this endpoint. Does not seem to also be the case with the DELETE endpoint
		 * so this method should be used before sending a DELETE request for a contact.
		 * @param {String} clientId  - the ID of the client the contact should be a part of
		 * @param {String} contactId - the ID of the contact to be checked
		 */
		doesContactBelongToClient : async function(clientId, contactId) {
			try {
				const contact = await this.getContact(clientId, contactId);
				return `${contact.clientId}` === clientId; // needs to be converted to a string since the object returned holds it as an int
			}
			catch(err) {
				return false;
			}
		},

		/**
		 * Track user activity into the ClientSuccess usage module
		 * @param  {Object}  [options]
		 * @param  {String}  [options.clientID]      - ID of the ClientSuccess client that the usage will be logged under
		 * @param  {String}  [options.contactID]     - ID of the contact that the activity originated from
		 * @param  {String}  [options.activity]      - Activity name that occurred
		 * @param  {Number}  [options.occurrences=1] - Number of times that the user completed this action
		 * @param  {Date}    [options.timestamp]     - ISO 8601 formatted timestamp that the event occured
		 */
		trackActivity : async function({ clientID, contactID, activity, occurrences = 1, timestamp } = {}) {
			this.validateClientSuccessId(clientID);
			const client           = await this.getClient(clientID);
			const activityIdentity = {
				identity : {
					organization : {
						id   : client.id,
						name : client.name,
					},
				},
				value : occurrences,
				keen  : {
					timestamp : timestamp ? new Moment(timestamp).toISOString() : '',
				},
			};

			if (contactID) {
				activityIdentity.identity.user = {
					id : contactID,
				};
			}

			const response = await axios({
				method  : 'POST',
				url     : `https://usage.clientsuccess.com/collector/1.0.0/projects/${this.eventsProjectID}/events/${encodeURIComponent(activity)}?api_key=${this.eventsAPIKey}`,
				headers : { 'Content-Type' : 'application/json' },
				data    : activityIdentity,
			});

			return response;
		},

		/**
		 * Get ClientSuccess product ID based on product name
		 * @param  {String} productName - Name of the Product
		 * @return {Integer}            - ID of the Product
		 */
		getProductId : async function(productName) {
			const clientSuccessProducts = await this.hitClientSuccessAPI('GET', 'products');

			const foundProduct = _.find(clientSuccessProducts, { active : true, name : productName });

			if (foundProduct) {
				return foundProduct.id;
			}

			throw new CustomError({ status : 404, message : 'Product not found' });
		},

		/**
		 * Create a new ClientSuccess Product Type
		 * @param  {String}  name                     - Name of the new Product Type
		 * @param  {Object}  [options]
		 * @param  {Boolean} [options.recurring=true] - Denotes if Subscription is recurring or not
		 * @return Promise<Object>                    - Promise with the resulting ClientSuccess Subscription object
		 */
		createProductType : function(name, { recurring = true } = {}) {
			if (!name) {
				throw new CustomError({ status : 400, message : 'Product Name Required' });
			}

			const productAttributes = {
				name,
				recurring,
				active : true,
			};

			return this.hitClientSuccessAPI('POST', 'products', productAttributes);
		},

		deleteProduct : function(productId) {
			if (!productId) {
				throw new CustomError({ status : 400, message : 'Product ID Required for Deletion' });
			}

			return this.hitClientSuccessAPI('DELETE', `products/${productId}`);
		},

		/**
		 * Get all subscription items for a client
		 * @param  {String} clientID - ClientSuccess Client ID
		 * @return Promise<Object[]>   - Subscriptions list for the provided Client ID
		 */
		getClientActiveSubscriptions : async function(clientID) {
			this.validateClientSuccessId(clientID);

			const clientSubscriptions = await this.hitClientSuccessAPI('GET', `subscriptions?clientId=${clientID}`);
			if (clientSubscriptions.length === 0) {
				throw new CustomError({ status : 404, message : 'No subscriptions found for client' });
			}

			// ClientSuccess has outlined that Subscriptions that are considered 'Active' have attribute isPotential = false
			// Loop through the returned array and pull out the 'Active' subscriptions
			return clientSubscriptions.filter(function(subscription) {
				if (subscription.isPotential === undefined) {
					throw new CustomError({ status : 404, message : 'Subscription isPotential attribute does not exist.' });
				}

				if (subscription.isPotential === false && (subscription.terminationDate === null || subscription.renewedDate === null)) {
					return true;
				}
			});
		},

		/**
		 * Create a ClientSuccess Subscription line item under the passed Client
		 * @param  {String} clientID   - ClientSuccess Client
		 * @param  {Object} attributes - List of Subscription attributes
		 * @return Promise<Object>     - Resulting ClientSuccess Subscription created
		 */
		createClientSubscription : function(clientID, attributes) {
			this.validateClientSuccessId(clientID);

			// add clientID to the attributes array
			const finalAttributes = Object.assign({}, attributes, { clientId : clientID });

			return this.hitClientSuccessAPI('POST', 'subscriptions', finalAttributes);
		},

		/**
		 * Update a ClientSuccess Client subscription
		 * @param  {Object} subscriptionObject - Subscription object to update
		 * @param  {Object} attributesToUpdate - Attribute object to update the subscription with
		 * @return Promise<Object>             - Resulting ClientSuccess Subscription that was updated
		 */
		updateClientSubscription : function(subscriptionObject, attributesToUpdate) {
			if (!subscriptionObject.id) {
				throw new CustomError({ status : 400, message : 'Passed subscription object does not have an ID' });
			}

			Object.assign(subscriptionObject, attributesToUpdate);

			return this.hitClientSuccessAPI('PUT', `subscriptions/${subscriptionObject.id}`, subscriptionObject);
		},

		/**
		 * Delete a ClientSuccess Client subscription
		 * @param  {Integer} subscriptionID - Subscription ID of the subscription to be deleted
		 * @return Promise<Object>          - Promise with the response object of deletion result
		 */
		deleteClientSubscription : function(subscriptionID) {
			if (!subscriptionID) {
				throw new CustomError({ status : 400, message : 'Subscription ID Not Provided' });
			}

			return this.hitClientSuccessAPI('DELETE', `subscriptions/${subscriptionID}`);
		},
	},
});

JS.class(CustomError, {
	inherits : Error,

	fields : {
		/**
		 * HTTP error status code
		 * @type {String}
		 */
		status : {
			type : String,
		},

		/**
		 * Message ClientSuccess returns in their Error reponses
		 * @type {String}
		 */
		userMessage : {
			type : String,
		},
	},

	constructor : function({ status, message, userMessage }) {
		this.status      = status;
		this.message     = message;
		this.userMessage = userMessage;
	},
});
