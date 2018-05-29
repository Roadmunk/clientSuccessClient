const JS            = require('@roadmunk/jsclass/JS');
const axios         = require('axios');
const _             = require('lodash');

const RETRY_LIMIT = 10;	// number of retry attempts for any given API call
const URL         = 'https://api.clientsuccess.com/v1/';

const ClientSuccessClient = module.exports                          = JS.class('ClientSuccessClient');
const TooManyAttempts     = ClientSuccessClient.TooManyAttempts     = JS.class('TooManyAttempts');
const AuthenticationError = ClientSuccessClient.AuthenticationError = JS.class('AuthenticationError');

// TODO: Abstract attributes to a config file (what would be best practice here) (username, password, api retry limit, etc)
// add return types in comments

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
			let response;

			const params = {
				username : this.username,
				password : this.password,
			};

			try {
				response = await axios({
					method : 'POST',
					url    : `${URL}auth`,
					data   : params,
				});

				this.authToken = response.data['access_token'];
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
		 * @param {String} method    - Type of the API call.
		 * @param {String} path      - URI path of the ClientSuccess endpoint we are looking to hit.
		 * @param {Object} data      - Data set that will be passed through to the ClientSuccess API endpoint.
		 * @returns {Object | null}  - response body from the HTTP request
		 * @throws {TooManyAttempts} - when the retryLimit has been reached.
		 */
		hitClientSuccessAPI : async function(method, path, data) {
			if (!method) {
				throw new Error('method required');
			}

			let response;

			// Retry for block to re-attempt API call if an expired token is encountered
			// Limited by the retryLimit constant above
			for (let retry = 0; retry < RETRY_LIMIT; retry++) {
				if (!this.authToken) {
					await this.authenticate();
				}

				try {
					response = await axios({
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
						throw new Error(`Invalid request, status code: ${error.response.status} - ${error.response.statusText}`);
					}
				}
			}

			throw new TooManyAttempts();
		},

		/**
		 * Get ClientSuccess client object.
		 * @param {String}   - [clientId]
		 * @returns {Object} - ClientSuccess Client Data object
		 * @throws {Error}   - Invalid data type for clientId attribute
		 */
		getClient : async function(clientId) {
			if (!clientId || isNaN(clientId)) {
				throw new Error('Invalid clientId data type for getClient, expecting integer');
			}

			return this.hitClientSuccessAPI('GET', `clients/${clientId}`);
		},

		/**
		 * Get ClientSuccess Client object by the externalId attribute
		 * @param {String} externalId - Value of external ID attribute on the Client object you are looking for.
		 * @returns {Object}          - Client detail object of the found user
		 */

		getClientExternalId : async function(externalId) {
			if (!externalId) {
				throw new Error('Invalid externalId for getClientExternalId.');
			}

			return this.hitClientSuccessAPI('GET', `clients/?externalId=${externalId}`);
		},

		/**
		 * Create a ClientSuccess client.
		 * @param {Object} attributes    - Attributes of the user we would like to create
		 * @returns {Object}             - Resulting user object created on ClientSuccess
		 */
		createClient : async function(attributes, customAttributes) {
			// Check to make sure that there isn't already a client based on externalId
			if (attributes.externalId) {
				try {
					// try finding a contact
					const foundClient = await this.getClientExternalId(attributes.externalId);
					return foundClient;
				}
				catch (err) {
					// user was not found, therefore we can continue to creation
				}
			}

			const createdUser = await this.hitClientSuccessAPI('POST', 'clients', attributes);

			if (!customAttributes) {
				return createdUser;
			}

			// update the created user with the custom attributes
			// ClientSuccess requires that we pass through ALL custom attributes in the create statement
			// This would not be good for making a general adapter...
			// SHOULDDO: Pass in a custom attributes structure array to create the user will null custom
			// values initially (and patch any supplied custom attributes)
			return this.updateClient(createdUser.id, attributes, customAttributes);
		},

		/**
		 * Update a ClientSuccess client object.
		 * @param {String} clientId         - ClientSuccess clientId
		 * @param {Object} attributes       - List of attributes and values that we would like to update
		 * @param {Object} customAttributes - Custom attributes that need to be set for the ClientSuccess Client Object
		 * @returns {Object}                - The object of the resulting updated user
		 */
		updateClient : async function(clientId, attributes, customAttributes) {
			// ClientSuccess requires that all 'required' fields to be passed through to the update API
			// First, we should get the current client state data, and only modify what we are looking to update
			// TODO: come back when ClientSuccess API accepts single attribute updates

			if (!clientId || isNaN(clientId)) {
				throw new Error('Invalid clientId data type for updateClient, expecting integer');
			}

			const clientToUpdate = await this.getClient(clientId);
			Object.assign(clientToUpdate, attributes); // assign the new data values to the existing data object
			if (customAttributes) {
				this.patchCustomAttributes(clientToUpdate, customAttributes);
			}

			// Send the updated data object back up to ClientSuccess
			return this.hitClientSuccessAPI('PUT', `/clients/${clientId}`, clientToUpdate);
		},

		/**
		 * Creates or updates a client with the given attribgutes.
		 * @param  {String} [clientId=undefined]
		 * @param  {Object} attributes
		 * @return {String} clientId
		 */
		upsertClient : async function(clientId, attributes, customAttributes) {
			if (arguments.length < 3 && typeof clientId == 'object') {
				// only attributes are passed into the clientId slot, move it to the attributes slot
				attributes = clientId;
				const client = await this.createClient(attributes);
				clientId = client.id;
				// create a check object to see if we had the intention of updating the client
				const updateClientAttributes = Object.assign({}, client); // clone the client object for comparason purposes
				this.patchCustomAttributes(updateClientAttributes, customAttributes);
				// check to see if a client update is required
				if (JSON.stringify(Object.assign(updateClientAttributes, attributes)) == JSON.stringify(client)) {
					return client;
				}
			}
			return clientId ? this.updateClient(clientId, attributes, customAttributes) : this.createClient(attributes, customAttributes);
		},

		/**
		 * Close the ClientSuccess Client object by setting the statusId to "4", which equals "Terminated"
		 * @param  {string} clientId - Client ID of the Client we are looking to close
		 * @return {Object}          - Closed cliend detail object
		 */
		closeClient : async function(clientId) {
			return this.updateClient(clientId, { statusId : 4 });
		},

		/**
		 * Get ClientSuccess Contact detail object.
		 * @param {String} clientId  - ClientSuccess Client ID that we are looking to look under.
		 * @param {String} contactId - ClientSuccess Contact ID that we are looking to pull back
		 * @returns {Object}         - ClientSuccess Contact Detail object of the located user.
		 */
		getContact : async function(clientId, contactId) {
			if (isNaN(clientId) || isNaN(contactId)) {
				throw new Error('Invalid clientId or contactId data type for getContact, expecting integer');

			}

			return this.hitClientSuccessAPI('GET', `clients/${clientId}/contacts/${contactId}/details`);
		},

		/**
		 * Gets the ClientSuccess Contact object using both the Client External ID and the Contact Email
		 * Preffered to pull by ClientSuccess Client ID, but this method is not supported yet.
		 * @param  {String} clientExternalId - Client External ID of the Client we are going to look under
		 * @param  {String} contactEmail     - Email of the Contact we are looking for
		 * @return {Object}                  - Contact Object of the found user
		 */
		getContactByEmail : async function(clientExternalId, contactEmail) {
			if (!clientExternalId || !contactEmail) {
				throw new Error('Invalid clientExternalId or contactEmail for getContactByEmail');
			}

			return this.hitClientSuccessAPI('GET', `contacts?clientExternalId=${clientExternalId}&email=${contactEmail}`);
		},

		/**
		 * Create a ClientSuccess Contact.
		 * @param {String} clientId         - ClientSuccess Client ID that we are creating the contact under.
		 * @param {String} attributes       - Contact Attributes we would like to instantiate the Contact with.
		 * @param {Object} customAttribtues - Custom attributes that we will be creating the client with
		 * @returns {Object}.               - ClientSuccess Contact object that has been created
		 */
		createContact : async function(clientId, attributes, customAttributes) {
			const createdContact = await this.hitClientSuccessAPI('POST', `clients/${clientId}/contacts`, attributes);

			if (!customAttributes) {
				return createdContact;
			}

			// else, we need to now update the contact with custom attributes
			return this.updateContact(clientId, createdContact.id, attributes, customAttributes);
		},

		/**
		 * Update a ClientSuccess Contact object.
		 * @param {String} clientId         - ClientSuccess Client ID that the Contact is contained within.
		 * @param {String} contactId        - ClientSuccess Contact ID of the user that we are looking to update.
		 * @param {Object} attributes       - Attributes that we are looking to update the ClientSuccess Contact data model with.
		 * @param {Object} customAttributes - Custom attributes that we want to update the contact with
		 * @returns {Object}                - Contact data model of the newly updated contact.
		 */
		updateContact : async function(clientId, contactId, attributes, customAttributes) {
			if (isNaN(clientId) && isNaN(contactId)) {
				throw new Error('Invalid clientId or contactId data type for updateContact, expecting integer');
			}

			// Grab the contact first
			const contactToUpdate = await this.getContact(clientId, contactId);

			Object.assign(contactToUpdate, attributes); // assign the new data values to the existing data object

			if (customAttributes) {
				this.patchCustomAttributes(contactToUpdate, customAttributes);
			}

			// Push updated local user object back up to ClientSuccess
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
		upsertContact : async function(clientId, contactId, attributes, customAttributes) {
			if (!clientId) {
				throw new Error('clientId is required for upsertContact');
			}

			if (arguments.length < 4 && typeof contactId == 'object') {
				// only attributes are passed into the clientId slot, move it to the attributes slot
				customAttributes = attributes;
				attributes = contactId;
				const contact = await this.createContact(clientId, attributes, customAttributes);
				contactId = contact.id;
				// check to see if we were intended to update the user object
				let updateContactAttributes = Object.assign({}, contact); // clone the client object for comparason purposes
				if (!_.get(updateContactAttributes, 'customFieldValues[0]')) {
					// The ClientSuccess create contact API does not return back clean custom attributes, only null values
					// We need to pull down a clean object using the getContact API to get around this
					// A bug report has been filed with them
					updateContactAttributes = await this.getContact(clientId, contactId);
				}
				this.patchCustomAttributes(updateContactAttributes, customAttributes);
				// check to see if a customAttribute update is required
				if (JSON.stringify(Object.assign(updateContactAttributes, attributes)) == JSON.stringify(contact)) {
					return contact;
				}
			}

			return contactId ? this.updateContact(clientId, contactId, attributes, customAttributes) : this.createContact(clientId, attributes, customAttributes);
		},

		/**
		 * Finds the Client Type ID associated with the Client Success Client Type Title
		 * @param  {String} clientTypeString - Title of the Client Type we are looking for
		 * @return {Integer}                 - ID of the Client Type we are looking for
		 */
		getClientTypeId : async function(clientTypeString) {
			if (!clientTypeString) {
				throw new Error('No clientTypeString provided in getClientTypeId');
			}

			if (!this.clientTypes) {
				this.clientTypes = await this.hitClientSuccessAPI('GET', 'client-segments');
			}

			const clientType = this.clientTypes.find(o => o.title === clientTypeString);
			// const clientType = _.find(this.clientTypes, { title : clientTypeString });
			return clientType.id;
		},

		/**
		 * Helper function for patching a ClientSuccess object's custom attribtues fields.
		 * Uses the 'Label' field for matching
		 * @param  {Object} object           - Object that we are looking to patch
		 * @param  {Object} customAttributes - Object of custom attributes and their desired values (keyed on custom attribute label)
		 */
		patchCustomAttributes : function(object, customAttributes) {
			for (const customAttribute in customAttributes) {
				for (let i = 0; i < object.customFieldValues.length; i++) {
					if (customAttribute == object.customFieldValues[i].label) {
						object.customFieldValues[i].value = customAttributes[customAttribute];
					}
				}
			}
		},
	},
});

JS.class(TooManyAttempts, {
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
