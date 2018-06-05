const JS    = require('@roadmunk/jsclass/JS');
const axios = require('axios');
const _     = require('lodash');

const RETRY_LIMIT = 10;	// number of retry attempts for any given API call
const URL         = 'https://api.clientsuccess.com/v1/';

const ClientSuccessClient  = module.exports                           = JS.class('ClientSuccessClient');
const TooManyAttemptsError = ClientSuccessClient.TooManyAttemptsError = JS.class('TooManyAttemptsError');
const AuthenticationError  = ClientSuccessClient.AuthenticationError  = JS.class('AuthenticationError');

JS.class(ClientSuccessClient, {
	fields : {
		username    : null,
		password    : null,
		authToken   : null,
		clientTypes : null,
	},

	constructor : function(username, password) {
		this.username = username;
		this.password = password;
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
					throw new AuthenticationError();
				}

				throw new Error(`Invalid request, status code: ${error.response.status} - ${error.response.statusText}`);
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
				throw new Error('method required');
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
						throw new Error('ClientSuccess Service Temporarily Unavailable');
					}
					else {
						// Package up the resulting API error for the function caller to handle on the other end
						throw error;
					}
				}
			}

			throw new TooManyAttemptsError();
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
		 * @returns {Object}          - ClientSuccess Client Data object
		 */
		getClientByExternalId : async function(externalId) {
			if (!externalId || !_.isString(externalId)) {
				throw new Error({ status : 400, message : 'Invalid externalId for getClientByExternalId.' });
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
					if (error.response.status !== 404) {
						throw error;
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
		 * @returns {Object}                - The object of the resulting updated Client
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
				// no client ID, create the user
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
		 * Get ClientSuccess Contact detail object.
		 * @param {String} clientId  - ClientSuccess Client ID that contains the Contact
		 * @param {String} contactId - ClientSuccess Contact ID
		 * @returns {Object}         - ClientSuccess Contact Detail object of the located contact.
		 */
		getContact : async function(clientId, contactId) {
			this.validateClientSuccessId(clientId);
			this.validateClientSuccessId(contactId);

			return this.hitClientSuccessAPI('GET', `clients/${clientId}/contacts/${contactId}/details`);
		},

		/**
		 * Gets the ClientSuccess Contact object using both the Client External ID and the Contact Email
		 * Preferred to pull by ClientSuccess Client ID, but this method is not supported yet.
		 * @param  {String} clientExternalId - Client External ID of the Client to be searched
		 * @param  {String} contactEmail     - Email of the Contact
		 * @return {Object}                  - Contact Object of the found contact
		 */
		getContactByEmail : function(clientExternalId, contactEmail) {
			if (!clientExternalId || !contactEmail) {
				throw new Error('Invalid clientExternalId or contactEmail for getContactByEmail');
			}

			return this.hitClientSuccessAPI('GET', `contacts?clientExternalId=${clientExternalId}&email=${contactEmail}`);
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
		 * @returns {Object}                - Contact data model of the newly updated contact.
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
		 * @param  {String} contactId        (Optional) if provided, it will trigger an update, else it will create a new Contact
		 * @param  {Object} attributes       ClientSuccess native Contact attributes to fill
		 * @param  {Object} customAttributes ClientSuccess Contact custom attributes to fill
		 * @return {Object}                  Resulting Contact data object
		 */
		upsertContact : async function({ clientId = undefined, contactId = undefined, attributes = {}, customAttributes = {} } = {}) {
			this.validateClientSuccessId(clientId);

			if (!contactId) {
				const contact = await this.createContact(clientId, attributes, customAttributes);
				contactId     = contact.id;
				// check to see if system was intended to update the Contact object
				let updateContactAttributes = Object.assign({}, contact); // clone the client object for comparason purposes
				if (!_.get(updateContactAttributes, 'customFieldValues[0]')) {
					// The ClientSuccess create contact API does not return back clean custom attributes, only null values
					// Need to pull down a clean object using the getContact API to get around this
					// A bug report has been filed with them
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
		 * Finds the Client Type ID associated with the ClientSuccess Client Type Title
		 * @param  {String} clientTypeString - Title of the Client Type
		 * @return {Number}                  - ID of the Client Type
		 */
		getClientTypeId : async function(clientTypeString) {
			if (!clientTypeString) {
				throw new Error('No clientTypeString provided in getClientTypeId');
			}

			if (!this.clientTypes) {
				this.clientTypes = await this.hitClientSuccessAPI('GET', 'client-segments');
			}

			const clientType = _.find(this.clientTypes, { title : clientTypeString });
			return clientType.id;
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
			if (!clientSuccessId || isNaN(parseInt(clientSuccessId)) || !isFinite(clientSuccessId) || clientSuccessId % 1 !== 0) {
				throw new Error({ status : 400, message : 'Invalid ClientSuccess ID' });
			}
			return true;
		},
	},
});

JS.class(TooManyAttemptsError, {
	inherits : Error,

	constructor : function() {
		this.message = 'Too Many Requests';
	},
});

JS.class(AuthenticationError, {
	inherits : Error,

	constructor : function() {
		this.message = 'Authentication Error';
	},
});
